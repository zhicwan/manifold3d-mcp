/**
 * Backwards-compatible re-export. The wire types now live in
 * src/shared/wire/annotations.ts so the viewer (browser) and server
 * (Node) can import the SAME definition without duplicating the
 * interface in two trees that drift over time (VIE-7).
 */
export {
  isAnnotationsMessage,
  type AnnotationsMessage,
  type HelloMessage,
  type WireAnnotation,
} from '../../shared/wire/annotations.js';
