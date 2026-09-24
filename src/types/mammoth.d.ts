// mammoth ships no type declarations and none exist on @types - minimal
// ambient typing for the one function this app calls.
declare module "mammoth" {
  interface ExtractRawTextResult {
    value: string;
    messages: unknown[];
  }
  function extractRawText(input: { buffer: Buffer }): Promise<ExtractRawTextResult>;
  const mammoth: { extractRawText: typeof extractRawText };
  export default mammoth;
  export { extractRawText };
}
