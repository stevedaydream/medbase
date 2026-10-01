declare module "duty-doc-reader" {
  interface DocImage { mime: string; bytes: Uint8Array }
  interface DocReader {
    (data: ArrayBuffer | Uint8Array): string | null;
    images(data: ArrayBuffer | Uint8Array): DocImage[];
  }
  const docToText: DocReader;
  export default docToText;
}
