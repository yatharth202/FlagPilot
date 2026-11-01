
export const normalizeProjectMemberEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isValidProjectMemberEmail = (value) => {
  const email = normalizeProjectMemberEmail(value);
  return email.length <= 254 && /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email);
};
