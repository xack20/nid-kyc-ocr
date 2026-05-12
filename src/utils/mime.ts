import type { Interactions } from '@google/genai';

export type ImageMimeType = NonNullable<Interactions.ImageContent['mime_type']>;

const ALLOWED: ImageMimeType[] = [
  'image/jpeg', 'image/png', 'image/webp',
  'image/heic', 'image/heif', 'image/gif',
  'image/bmp',  'image/tiff',
];

const EXT_MAP: Record<string, ImageMimeType> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.gif':  'image/gif',
  '.bmp':  'image/bmp',
  '.tiff': 'image/tiff',
  '.tif':  'image/tiff',
};

export function toImageMimeType(mime: string): ImageMimeType {
  return ALLOWED.includes(mime as ImageMimeType)
    ? (mime as ImageMimeType)
    : 'image/jpeg';
}

export function mimeFromExt(ext: string): ImageMimeType {
  return EXT_MAP[ext.toLowerCase()] ?? 'image/jpeg';
}
