export type AbiValue = string | bigint | boolean | readonly string[] | readonly bigint[];

export const SELECTORS = {
  deposit: '0x8e27d719',
  create: '0xc1f995ed',
  delegate: '0xd0b45cd1',
  dispatch: '0x43c34be8',
  deliver: '0x0bc005e9',
  accept: '0xbdee1c6e',
  cancel: '0x660d72c1',
  withdraw: '0x2312106a',
  grantAuthority: '0xaed70ccb',
  assignProvider: '0xc6c2d30c',
  dispatchProvider: '0xe0066b90',
  deliverProvider: '0x2a3929d8',
  acceptProvider: '0xef912b88',
  withdrawProvider: '0x2d40d3cd',
  createReviewedTask: '0x90e99f47',
  assignVerifier: '0xb37bc2fb',
  submitVerifierResult: '0xf6b6a778',
  revokeReviewer: '0xd171babe',
  withdrawVerifierReward: '0x274830df',
} as const;

export type CoooMethod = keyof typeof SELECTORS;
