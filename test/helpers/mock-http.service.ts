import { of, throwError } from 'rxjs';

export function mockHttpGet(responses: Record<string, unknown> | unknown[]) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  return {
    get: jest.fn().mockImplementation(() => {
      const next = queue.shift();
      if (next instanceof Error) return throwError(() => next);
      return of({ data: next });
    }),
    post: jest.fn().mockImplementation(() => {
      const next = queue.shift();
      if (next instanceof Error) return throwError(() => next);
      return of({ data: next });
    }),
  };
}

export function nvdPageResponse(vulnerabilities: unknown[], totalResults?: number) {
  return {
    totalResults: totalResults ?? vulnerabilities.length,
    vulnerabilities: vulnerabilities.map((cve) => ({ cve })),
  };
}

export function nvdCve(id: string, lastModified = '2024-01-01T00:00:00.000') {
  return {
    id,
    vulnStatus: 'Analyzed',
    descriptions: [{ lang: 'en', value: `Description for ${id}` }],
    metrics: {},
    references: [],
    published: '2024-01-01T00:00:00.000',
    lastModified,
  };
}
