import { describe, expect, it } from 'vitest';
import { classifiedRequest } from '../src/requests/request-lifecycle';

const result = { category: 'billing', confidence: 0.86 } as const;

describe('classifiedRequest', () => {
  it('stores the result and starts work on an open request', () => {
    expect(classifiedRequest({ status: 'open' }, result)).toEqual({
      status: 'in_progress',
      category: 'billing',
      confidence: 0.86,
    });
  });

  it.each(['in_progress', 'resolved'] as const)('keeps the status of a %s request', (status) => {
    expect(classifiedRequest({ status }, result)).toEqual({
      status,
      category: 'billing',
      confidence: 0.86,
    });
  });

  it('does not change what it is given', () => {
    const request = { status: 'open' as const };

    classifiedRequest(request, result);

    expect(request).toEqual({ status: 'open' });
  });
});
