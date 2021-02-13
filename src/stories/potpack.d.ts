declare module 'potpack' {
  export interface PotPackItem {
    w: number;
    h: number;
    x: number;
    y: number;
  }

  export interface PotPackResult {
    w: number;
    h: number;
    fill: number;
  }

  function potpack(boxes: PotPackItem[]): PotPackResult;

  export default potpack;
}
