import {
  captureReplacement,
  createWorkflowController,
  FigmaRenderOrchestrator,
  findGeneratedDocumentTarget,
  firstNativeProseTypography,
  isGeneratedSceneNode,
  readSelectionSnapshot,
  replaceWithRenderedDocument,
  replacementNodeFor,
  selectedSnapshotNode,
  type FigmaRenderApi,
  type GeneratedSceneNode,
  type WorkflowRenderRequest,
  type WorkflowTarget,
} from './figma';
import { readPersistedDocumentState } from './figma/persistence';
import { isUIToPluginMessage, type PluginToUIMessage, type WorkflowMode } from './shared/messages';

declare const __html__: string;
const UI_SIZE = { width: 440, height: 620 };
const postToUi = (message: PluginToUIMessage): void => {
  figma.ui.postMessage(message);
};
// One controller-session inventory promise serves UI choices and marked-font resolution.
let availableFontsPromise: Promise<readonly FontName[]> | undefined;
const listAvailableFonts = (): Promise<readonly FontName[]> =>
  (availableFontsPromise ??= figma
    .listAvailableFontsAsync()
    .then((fonts) => fonts.map((font) => font.fontName)));
const command: WorkflowMode =
  figma.command === 'edit'
    ? 'edit'
    : figma.command === 'reflow'
      ? 'reflow'
      : figma.command === 'sync-typography'
        ? 'sync-typography'
        : 'create';

const renderApi: FigmaRenderApi = {
  listAvailableFontsAsync: listAvailableFonts,
  loadFontAsync: (font: FontName) => figma.loadFontAsync(font),
  createText: () => figma.createText(),
  flatten: (nodes) => figma.flatten(nodes as TextNode[]),
  createNodeFromSvg: (svg: string) => figma.createNodeFromSvg(svg),
  createFrame: () => figma.createFrame(),
  appendChild: (parent, child) => (parent as FrameNode).appendChild(child as SceneNode),
  get currentPage() {
    return figma.currentPage;
  },
  viewport: figma.viewport,
};
const renderer = new FigmaRenderOrchestrator(renderApi);
const widthOf = (node: GeneratedSceneNode): number | undefined =>
  typeof node.width === 'number' && Number.isFinite(node.width) ? node.width : undefined;
const targetForRoot = (node: unknown): WorkflowTarget | undefined => {
  if (!isGeneratedSceneNode(node)) return undefined;
  const width = widthOf(node);
  const state = readPersistedDocumentState(node, width);
  return state && width ? { node, state, width } : undefined;
};
const targetAfterCommit = (root: unknown): WorkflowTarget => {
  const target = targetForRoot(root);
  if (!target) throw new Error('Replacement committed without valid v3 persistence.');
  return target;
};
const renderExisting = async (
  request: WorkflowRenderRequest,
): Promise<{ readonly rootName: string; readonly nextTarget: WorkflowTarget }> => {
  const target = request.target;
  if (!target) throw new Error('No generated document is locked for this workflow.');
  const current = readPersistedDocumentState(target.node, widthOf(target.node));
  if (!current || JSON.stringify(current) !== JSON.stringify(target.state))
    throw new Error('The generated document changed before Apply.');
  const replacementNode = replacementNodeFor(target.node);
  const replacement = replacementNode ? captureReplacement(replacementNode) : undefined;
  if (!replacement) throw new Error('The generated document changed before Apply.');
  const result = await replaceWithRenderedDocument(renderer, renderApi, request, replacement);
  return { rootName: result.root.name, nextTarget: targetAfterCommit(result.root) };
};
const renderCreate = async (
  request: WorkflowRenderRequest,
): Promise<{ readonly rootName: string; readonly consumedSelectedSnapshot?: boolean }> => {
  const selected = request.selectedSnapshot;
  const selectedNode = selected ? selectedSnapshotNode(selected) : undefined;
  if (!selected || !selectedNode) {
    const result = await renderer.render(request);
    return { rootName: result.root.name };
  }
  const replacementNode = replacementNodeFor(selectedNode);
  const replacement = replacementNode ? captureReplacement(replacementNode) : undefined;
  if (
    !replacement ||
    selectedNode.characters !== selected.source ||
    selectedNode.width !== selected.width ||
    selectedNode.x !== selected.placement.x ||
    selectedNode.y !== selected.placement.y ||
    selectedNode.rotation !== selected.placement.rotation
  )
    throw new Error('The selected text changed before Apply.');
  const result = await replaceWithRenderedDocument(renderer, renderApi, request, replacement);
  return { rootName: result.root.name, consumedSelectedSnapshot: true };
};
const controller = createWorkflowController({
  mode: command,
  availableFonts: listAvailableFonts,
  readSelection: () =>
    readSelectionSnapshot({
      mixed: figma.mixed,
      get currentPage() {
        return figma.currentPage;
      },
      loadFontAsync: (fontName) => figma.loadFontAsync(fontName),
    }),
  readTarget: async () => {
    const selection = figma.currentPage.selection.filter(isGeneratedSceneNode);
    const found = findGeneratedDocumentTarget(selection);
    return found ? targetForRoot(found.root) : undefined;
  },
  readSyncedTypography: async (target) => firstNativeProseTypography(target.node, figma.mixed),
  postToUi,
  closePlugin: () => figma.closePlugin(),
  renderDocument: async (request) =>
    request.target ? renderExisting(request) : renderCreate(request),
});
figma.showUI(__html__, { ...UI_SIZE, themeColors: true });
figma.ui.onmessage = (message: unknown) => {
  if (!isUIToPluginMessage(message)) {
    postToUi({ type: 'RENDER_ERROR', message: 'Ignored an invalid message from the plugin UI.' });
    return;
  }
  controller.handleMessage(message);
};
// Create captures selection once at command open. Do not retarget a dirty editor
// when canvas selection changes during editing or after a replacement render.
// The UI repeats REQUEST_INITIALIZATION after subscribing, so an early post cannot be lost.
void controller.initialize();
