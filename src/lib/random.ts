import { randomInt } from 'crypto';

export function secureRandomIndex(length: number): number {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error('Invalid collection length');
  }

  return randomInt(length);
}

export function secureRandomFloat(): number {
  const maxUint32PlusOne = 0x100000000;
  return randomInt(maxUint32PlusOne) / maxUint32PlusOne;
}
