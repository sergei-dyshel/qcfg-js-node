import { zod } from "@sergei-dyshel/typescript/zod";

export type Infer<T extends zod.ZodSchema> = zod.infer<T>;

type Handler<T> = (name: string, value: T) => string[];

const HandlerSym = Symbol();

type SchemaWithHandler<T extends zod.ZodSchema> = T & {
  [HandlerSym]: Handler<Infer<T>>;
};

function addHandler<T extends zod.ZodSchema>(schema: T, handler: Handler<Infer<T>>) {
  (schema as SchemaWithHandler<T>)[HandlerSym] = handler;
  return schema;
}

function getHandler<T extends zod.ZodSchema>(schema: T) {
  return (schema as SchemaWithHandler<T>)[HandlerSym];
}

// function longOption<T>(handler: (value: T) => string[]): Handler<T> {
//   return (name, value) => {
//     return ["--" + name, ...handler(value)];
//   };
// }

export const schema = zod.object;

export function boolean() {
  return addHandler(zod.boolean().optional(), (name, value) => (value ? ["--" + name] : []));
}

export function string() {
  return addHandler(zod.string().optional(), (name, value) => (value ? ["--" + name, value] : []));
}

export function process<T extends zod.AnyZodObject>(schema: T, data: Infer<T>): string[] {
  const opts: string[] = [];
  for (const name in schema.shape) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const fieldSchema = schema.shape[name] as zod.ZodAny;
    opts.push(...getHandler(fieldSchema)(name, data[name]));
  }
  return opts;
}
