import Schema from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";

//#region src/types.d.ts

type SignalSort = 'latest' | 'repeat' | 'pain' | 'verifiable';
interface IdeaConfig {
  defaultRoot: string;
  reportDir: string;
  maxFiles: number;
  maxRows: number;
  maxFileBytes: number;
  maxTextChars: number;
  maxResultChars: number;
  defaultLanguage: string;
  defaultSort: SignalSort;
  maxExternalUrls: number;
  maxExternalChars: number;
  requestTimeoutMs: number;
}
//#endregion
//#region src/index.d.ts
declare const name = "dsh-idea";
declare const inject: string[];
type Config = IdeaConfig;
declare const Config: Schema<IdeaConfig>;
declare function apply(ctx: Context, config: IdeaConfig): void;
//#endregion
export { Config, apply, inject, name };