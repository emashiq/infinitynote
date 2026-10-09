import { ReactNodeViewRenderer } from '@tiptap/react';
import type { ImageSize } from '../../shared/editor/doc-schema';
import { ImageNode } from '../../shared/editor/nodes';
import { ImageView } from './ImageView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    managedImage: {
      /** Sets the display size preset of the selected image. */
      setImageSize: (size: ImageSize) => ReturnType;
    };
  }
}

/** The app image node (D-053) with its view and the size command. */
export const ManagedImage = ImageNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },

  addCommands() {
    return {
      setImageSize:
        (size) =>
        ({ commands }) =>
          commands.updateAttributes('image', { size }),
    };
  },
});
