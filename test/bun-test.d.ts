declare module "bun:test" {
  interface AsyncExpectation {
    toThrow(expected: string | RegExp): Promise<void>;
  }

  interface Expectation {
    rejects: AsyncExpectation;
    toBe(expected: unknown): void;
    toBeDefined(): void;
    toContain(expected: string): void;
  }

  export function describe(name: string, fn: () => void): void;
  export function expect(value: unknown): Expectation;
  export function test(name: string, fn: () => void | Promise<void>): void;
}

interface SymbolConstructor {
  readonly observable: symbol;
}
