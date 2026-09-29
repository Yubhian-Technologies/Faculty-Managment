// mammoth ships no type declarations and none exist on @types - minimal
// ambient typing for the functions this app calls.
declare module "mammoth" {
  interface ExtractRawTextResult {
    value: string;
    messages: unknown[];
  }
  interface ConvertToHtmlResult {
    value: string;
    messages: unknown[];
  }
  function extractRawText(input: { buffer: Buffer }): Promise<ExtractRawTextResult>;
  function convertToHtml(input: { buffer: Buffer }): Promise<ConvertToHtmlResult>;
  const mammoth: { extractRawText: typeof extractRawText; convertToHtml: typeof convertToHtml };
  export default mammoth;
  export { extractRawText, convertToHtml };
}
