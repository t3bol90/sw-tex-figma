import type { FigmaDocumentRendererApi } from './document-renderer';
import type { CreationDestination } from './render-orchestrator';

const slideFor = (node: BaseNode): SlideNode | undefined => {
  let ancestor: BaseNode | null = node;
  while (ancestor) {
    if (ancestor.type === 'SLIDE') return ancestor;
    ancestor = ancestor.parent;
  }
  return undefined;
};

const pageFor = (node: BaseNode): PageNode | undefined => {
  let ancestor: BaseNode | null = node;
  while (ancestor) {
    if (ancestor.type === 'PAGE') return ancestor;
    ancestor = ancestor.parent;
  }
  return undefined;
};

export function captureSlideDestination(
  api: Pick<PluginAPI, 'editorType' | 'currentPage' | 'viewport'>,
  appendChild: FigmaDocumentRendererApi['appendChild'],
): CreationDestination | undefined {
  if (api.editorType !== 'slides') return undefined;
  const page = api.currentPage;
  let slide: SlideNode | undefined;
  if (api.viewport.slidesView === 'single-slide') {
    slide = page.focusedSlide ?? undefined;
  } else {
    for (const selected of page.selection) {
      const selectedSlide = slideFor(selected);
      if (!selectedSlide || (slide && selectedSlide !== slide)) {
        throw new Error('Select one slide or content on one slide, then apply again.');
      }
      slide = selectedSlide;
    }
  }
  if (!slide || slide.removed || pageFor(slide) !== page) {
    throw new Error('Open a slide or select content on one slide, then apply again.');
  }
  const capturedSlide = slide;
  return {
    place(root) {
      if (
        api.currentPage !== page ||
        page.removed ||
        capturedSlide.removed ||
        pageFor(capturedSlide) !== page
      ) {
        throw new Error(
          'The target slide changed before Apply. Open or select a slide and try again.',
        );
      }
      appendChild(capturedSlide, root);
      root.x = (capturedSlide.width - root.width) / 2;
      root.y = (capturedSlide.height - root.height) / 2;
      root.rotation = 0;
      return { x: root.x, y: root.y, rotation: 0 };
    },
  };
}
