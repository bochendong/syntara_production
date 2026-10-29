import {
  defaultRehypePlugins,
  defaultUrlTransform,
  type StreamdownProps,
  type UrlTransform,
} from 'streamdown';

type RehypePlugins = NonNullable<StreamdownProps['rehypePlugins']>;
type RehypePlugin = Extract<RehypePlugins[number], (...args: never[]) => unknown>;

// A section is limited to 250,000 characters by the staging editor. Leave room
// for its text and metadata, and accept only raster image formats.
export const MAX_LECTURE_IMAGE_URL_LENGTH = 200_000;

const [sanitize, schema] = defaultRehypePlugins.sanitize as [
  RehypePlugin,
  { protocols?: Record<string, string[]> },
];

export const lectureRehypePlugins: RehypePlugins = [
  defaultRehypePlugins.raw,
  [
    sanitize,
    {
      ...schema,
      protocols: { ...schema.protocols, src: [...(schema.protocols?.src ?? []), 'data'] },
    },
  ],
  defaultRehypePlugins.harden,
];

export const lectureUrlTransform: UrlTransform = (url, key, node) => {
  if (node.tagName === 'img' && key === 'src' && url.startsWith('data:')) {
    return url.length <= MAX_LECTURE_IMAGE_URL_LENGTH &&
      /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/]+={0,2}$/i.test(url)
      ? url
      : undefined;
  }
  return defaultUrlTransform(url, key, node);
};
