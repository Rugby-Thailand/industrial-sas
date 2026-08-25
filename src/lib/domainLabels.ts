export interface CodeTranslator {
  (key: string): string;
  has(key: string): boolean;
}

export function codeLabel(translate: CodeTranslator, code: string): string {
  return translate.has(code) ? translate(code) : code;
}
