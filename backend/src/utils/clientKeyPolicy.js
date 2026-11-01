/** Client keys are public identifiers scoped to one project/environment. */
export const resolveClientKeyEnvironment = (project, key) => {
  if (!project || typeof key !== "string" || !key) return null;
  if (project.devClientKey === key) return "dev";
  if (project.prodClientKey === key) return "prod";
  return null;
};

export const isEnvironmentAllowedForClientKey = (keyEnvironment, requestedEnvironment) => {
  if (!['dev', 'prod'].includes(keyEnvironment)) return false;
  if (requestedEnvironment === undefined || requestedEnvironment === null || requestedEnvironment === "") return true;
  return requestedEnvironment === keyEnvironment;
};
