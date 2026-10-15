import 'reflect-metadata';
import { MODULE_METADATA, SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { AiChatModule } from './ai-chat.module';

type Provider = unknown;

const classProviders = (providers: Provider[]): Function[] =>
  providers.flatMap((p) => {
    if (typeof p === 'function') return [p];
    const useClass = (p as { useClass?: unknown })?.useClass;
    return typeof useClass === 'function' ? [useClass] : [];
  });

// A constructor parameter typed with an interface, Pick<> or a type alias is
// emitted as `Object`, which Nest cannot resolve: the app fails to boot while
// unit tests that build the class by hand still pass.
describe('AiChatModule dependency injection', () => {
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    AiChatModule,
  ) as Provider[];

  it.each(classProviders(providers).map((c) => [c.name, c]))(
    '%s has resolvable constructor parameters',
    (_name, cls) => {
      const types = (Reflect.getMetadata('design:paramtypes', cls) ??
        []) as unknown[];
      const injected = new Set(
        (
          (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, cls) ??
            []) as Array<{ index: number }>
        ).map((d) => d.index),
      );
      const unresolvable = types
        .map((t, i) => ({ t, i }))
        .filter(({ t, i }) => (t === Object || t === undefined) && !injected.has(i))
        .map(({ i }) => i);
      expect(unresolvable).toEqual([]);
    },
  );
});
