declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfTextItem {
    str: string;
  }

  interface PdfTextContent {
    items: PdfTextItem[];
  }

  interface PdfPageData {
    getTextContent: () => Promise<PdfTextContent>;
  }

  interface PdfParseOptions {
    pagerender?: (pageData: PdfPageData) => Promise<string>;
  }

  interface PdfParseResult {
    text: string;
    numpages: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }

  function pdfParse(
    dataBuffer: Buffer,
    options?: PdfParseOptions,
  ): Promise<PdfParseResult>;

  export default pdfParse;
}
