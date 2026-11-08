export const PASSWORD_MIN_LENGTH=12;
export const PASSWORD_MAX_LENGTH=1024;
// Safari uses this hint when offering a generated password.
export const PASSWORD_RULES=`minlength: ${PASSWORD_MIN_LENGTH}; maxlength: ${PASSWORD_MAX_LENGTH};`;
export const validPassword=value=>typeof value==='string'&&value.length>=PASSWORD_MIN_LENGTH&&value.length<=PASSWORD_MAX_LENGTH;
