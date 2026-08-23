export class SuccessionValidationError extends Error {
  constructor(message: string, name = 'SuccessionValidationError') {
    super(message);
    this.name = name;
  }
}

export class BeneficiaryAccountClosedError extends SuccessionValidationError {
  readonly beneficiaryId: string;

  constructor(beneficiaryId: string) {
    super(
      'this heir closed their account — remove them and choose another. ' +
        'Re-registration cannot work: the username no longer resolves.',
      'BeneficiaryAccountClosedError',
    );
    this.beneficiaryId = beneficiaryId;
  }
}

export class BeneficiaryAddressMismatchError extends SuccessionValidationError {
  readonly username: string;
  readonly userAddress: string;

  constructor(username: string, userAddress: string, resolved: string) {
    super(
      `user_address ${userAddress} resolves to "${resolved}", not to the beneficiary "${username}" — ` +
        'wrapping under it would produce a blob the heir cannot open',
      'BeneficiaryAddressMismatchError',
    );
    this.username = username;
    this.userAddress = userAddress;
  }
}

export class UnsupportedItemTypeError extends SuccessionValidationError {
  readonly itemType: string;

  constructor(itemType: string) {
    super(
      `"${itemType}" is not an inheritable item type — only a secret, a note or a document ` +
        'can be left to an heir',
      'UnsupportedItemTypeError',
    );
    this.itemType = itemType;
  }
}
