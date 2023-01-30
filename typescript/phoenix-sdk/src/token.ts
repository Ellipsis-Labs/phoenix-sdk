import { TokenParams } from "./types";

export class Token {
  name: string;
  symbol: string;
  logoUri: string;
  data: TokenParams;

  constructor({
    name,
    symbol,
    logoUri,
    data,
  }: {
    name: string;
    symbol: string;
    logoUri: string;
    data: TokenParams;
  }) {
    this.name = name;
    this.symbol = symbol;
    this.logoUri = logoUri;
    this.data = data;
  }
}
