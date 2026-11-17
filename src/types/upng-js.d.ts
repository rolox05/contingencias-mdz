declare module 'upng-js' {
  interface DecodedImage {
    width: number;
    height: number;
    depth: number;
    ctype: number;
  }
  const UPNG: {
    decode(buffer: ArrayBuffer): DecodedImage;
    toRGBA8(image: DecodedImage): ArrayBuffer[];
  };
  export default UPNG;
}
