import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ClassifyRequestDto, MAX_MESSAGE_LENGTH } from '../src/requests/classify.dto';

const UUID = '3f2b1c9e-8d4a-4e6b-9a1f-2c5d7e8f9a0b';

// Names of the properties that failed validation, for a plain JSON body.
const invalidProperties = async (body: unknown) =>
  (await validate(plainToInstance(ClassifyRequestDto, body as object))).map((e) => e.property);

describe('ClassifyRequestDto', () => {
  it.each([
    ['a message', { message: 'help' }],
    ['a message and a UUID requestId', { message: 'help', requestId: UUID }],
    ['a null requestId', { message: 'help', requestId: null }],
    ['a message of exactly the maximum length', { message: 'a'.repeat(MAX_MESSAGE_LENGTH) }],
  ])('accepts %s', async (_name, body) => {
    expect(await invalidProperties(body)).toEqual([]);
  });

  it.each([
    ['a missing message', {}],
    ['an empty message', { message: '' }],
    ['a blank message', { message: ' \n\t ' }],
    ['a null message', { message: null }],
    ['a non-string message', { message: 123 }],
    ['a message over the maximum length', { message: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) }],
    // The limit is measured before trimming, as it always was.
    [
      'a message over the maximum length only because of trailing spaces',
      { message: 'a'.repeat(MAX_MESSAGE_LENGTH - 1) + '  ' },
    ],
  ])('rejects %s', async (_name, body) => {
    expect(await invalidProperties(body)).toEqual(['message']);
  });

  // The controller's pipe runs with stopAtFirstError, so the first failed check is the one reported.
  it.each([
    ['a missing message', {}, 'isString'],
    ['a non-string message', { message: 123 }, 'isString'],
    ['a blank message', { message: '   ' }, 'matches'],
    ['a message over the maximum length', { message: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) }, 'maxLength'],
  ])('reports only %s\'s most relevant reason', async (_name, body, reason) => {
    const [error] = await validate(plainToInstance(ClassifyRequestDto, body as object), {
      stopAtFirstError: true,
    });

    expect(Object.keys(error.constraints ?? {})).toEqual([reason]);
  });

  it.each([
    ['a non-UUID requestId', { message: 'help', requestId: 'abc' }],
    ['an empty requestId', { message: 'help', requestId: '' }],
    ['a numeric requestId', { message: 'help', requestId: 123 }],
  ])('rejects %s', async (_name, body) => {
    expect(await invalidProperties(body)).toEqual(['requestId']);
  });
});
