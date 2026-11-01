
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Sidebar from "../components/Sidebar.jsx";
import { motion } from "framer-motion";
import API, { getErrorMessage } from "../api/axios.js";
import { AuthContext } from "../context/auth-context.js";

const emptyForm = {
  name: "",
  key: "",
  description: "",
  environment: "dev",
  rolloutPercentage: 0,
};

function RolloutSlider({ flag, onCommit, disabled }) {
  const [localValue, setLocalValue] = useState(flag.rolloutPercentage ?? 0);
  const [committing, setCommitting] = useState(false);

  const maxValue =
    flag.environment === "prod"
      ? Math.min(100, Number(flag.rolloutPercentage || 0) + 25)
      : 100;

  useEffect(() => {
    setLocalValue(flag.rolloutPercentage ?? 0);
  }, [flag.rolloutPercentage]);

  const commit = async () => {
    if (committing || localValue === (flag.rolloutPercentage ?? 0)) return;

    setCommitting(true);

    try {
      const applied = await onCommit(flag, localValue);

      if (applied === false) {
        setLocalValue(flag.rolloutPercentage ?? 0);
      }
    } catch {
      setLocalValue(flag.rolloutPercentage ?? 0);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <label
          htmlFor={`rollout-${flag._id}`}
          className="text-xs font-medium text-slate-400"
        >
          Rollout percentage
        </label>

        <span className="font-mono text-sm font-semibold text-slate-100">
          {localValue}%
        </span>
      </div>

      <input
        id={`rollout-${flag._id}`}
        aria-label={`Rollout percentage for ${flag.name}`}
        type="range"
        min="0"
        max={maxValue}
        step="5"
        value={Math.min(localValue, maxValue)}
        disabled={disabled || committing}
        onChange={(e) => setLocalValue(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={(e) => {
          if (
            e.key.startsWith("Arrow") ||
            e.key === "Home" ||
            e.key === "End"
          ) {
            commit();
          }
        }}
        className="w-full cursor-pointer accent-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
      />

      <div className="mt-1 flex justify-between text-[11px] text-slate-600">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

function CreateFlagModal({
  onClose,
  onCreate,
  canCreate,
  isDeveloper = false,
  defaultEnvironment = "dev",
}) {
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    environment: defaultEnvironment,
  }));

  const [saving, setSaving] = useState(false);

  const setField = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const setName = (value) => {
    setForm((current) => ({
      ...current,
      name: value,
      key: current.key
        ? current.key
        : value
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, ""),
    }));
  };

  const submit = async (event) => {
    event.preventDefault();

    if (!canCreate) {
      toast.error("Your role cannot create a flag in this environment.");
      return;
    }

    const normalizedKey = String(form.key || "").trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9_.-]{0,99}$/.test(normalizedKey)) {
      toast.error(
        "Flag keys must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens."
      );
      document.getElementById("flag-key")?.focus();
      return;
    }

    if (!String(form.name || "").trim()) {
      toast.error("Enter a flag name.");
      return;
    }

    setSaving(true);

    try {
      await onCreate({
        ...form,
        name: form.name.trim(),
        key: normalizedKey,
      });
    } catch {
      // Parent displays the API error toast.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#141416] p-5 shadow-2xl sm:p-7"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-flag-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Flag configuration</p>
            <h2
              id="create-flag-title"
              className="mt-1 text-xl font-semibold text-white"
            >
              Create a feature flag
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Create a flag first, then configure its rollout and targeting.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-slate-500 hover:bg-white/5 hover:text-white"
          >
            ✕
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div>
            <label
              className="mb-1.5 block text-xs font-medium text-slate-300"
              htmlFor="flag-name"
            >
              Flag name
            </label>
            <input
              id="flag-name"
              className="input-control"
              required
              maxLength={80}
              placeholder="New checkout experience"
              value={form.name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-xs font-medium text-slate-300"
              htmlFor="flag-key"
            >
              Unique key
            </label>
            <input
              id="flag-key"
              className="input-control font-mono"
              required
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
              placeholder="new_checkout"
              value={form.key}
              onChange={(e) =>
                setField("key", e.target.value.toLowerCase().trim())
              }
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Use 1–100 lowercase letters, numbers, dots, underscores, or
              hyphens. This stable key is used in your SDK code.
            </p>
          </div>

          <div>
            <label
              className="mb-1.5 block text-xs font-medium text-slate-300"
              htmlFor="flag-description"
            >
              Description{" "}
              <span className="font-normal text-slate-600">(optional)</span>
            </label>
            <textarea
              id="flag-description"
              rows="2"
              className="input-control resize-y"
              maxLength={500}
              placeholder="What does this flag control?"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                className="mb-1.5 block text-xs font-medium text-slate-300"
                htmlFor="flag-environment"
              >
                Environment
              </label>
              <select
                id="flag-environment"
                className="input-control"
                value={form.environment}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    environment: e.target.value,
                    rolloutPercentage:
                      e.target.value === "prod"
                        ? 0
                        : current.rolloutPercentage,
                  }))
                }
              >
                <option value="dev">Development</option>
                <option value="prod" disabled={isDeveloper}>
                  Production (Owner/Admin only)
                </option>
              </select>
            </div>

            <div>
              <label
                className="mb-1.5 block text-xs font-medium text-slate-300"
                htmlFor="flag-rollout"
              >
                Initial rollout
              </label>
              <select
                id="flag-rollout"
                className="input-control"
                value={form.rolloutPercentage}
                disabled={form.environment === "prod"}
                onChange={(e) =>
                  setField("rolloutPercentage", Number(e.target.value))
                }
              >
                {form.environment === "prod" ? (
                  <option value="0">0% · Production starts at zero</option>
                ) : (
                  <>
                    <option value="0">0% · No rollout</option>
                    <option value="5">5%</option>
                    <option value="10">10%</option>
                    <option value="25">25%</option>
                    <option value="50">50%</option>
                    <option value="100">100%</option>
                  </>
                )}
              </select>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                Every new flag starts disabled. Development keeps the selected
                percentage; Production starts at 0% and is released through
                the approval workflow.
              </p>
            </div>
          </div>

          {!canCreate && (
            <p className="rounded-lg border border-amber-400/15 bg-amber-400/5 p-3 text-xs text-amber-200">
              Your account role doesn't have permission to create flags.
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-white/[0.07] pt-5">
            <button
              className="btn-secondary"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={saving || !canCreate}
              type="submit"
            >
              {saving ? "Creating…" : "Create flag"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function FlagCard({
  flag,
  onToggle,
  onRollout,
  onTargeting,
  onRollback,
  onCopyEnvironment,
  canManage,
  canConfigure,
  canToggle,
  canCopy,
}) {
  const [roles, setRoles] = useState(
    (flag.targeting?.explicit?.roles || []).join(", ")
  );

  const [userIds, setUserIds] = useState(
    (flag.targeting?.explicit?.userIds || []).join(", ")
  );

  const [rulesText, setRulesText] = useState(
    (flag.targeting?.rules || [])
      .map((rule) => `${rule.field} = ${rule.value}`)
      .join("\n")
  );

  const [targetingSaving, setTargetingSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState("");

  useEffect(() => {
    setRoles((flag.targeting?.explicit?.roles || []).join(", "));
    setUserIds((flag.targeting?.explicit?.userIds || []).join(", "));
    setRulesText(
      (flag.targeting?.rules || [])
        .map((rule) => `${rule.field} = ${rule.value}`)
        .join("\n")
    );
  }, [flag.targeting, flag._id]);

  const saveTargeting = async () => {
    const rules = [];

    for (const line of rulesText
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)) {
      const separator = line.indexOf("=");

      if (
        separator < 1 ||
        !line.slice(0, separator).trim() ||
        !line.slice(separator + 1).trim()
      ) {
        toast.error(`Invalid rule: "${line}". Use field = value.`);
        return;
      }

      rules.push({
        field: line.slice(0, separator).trim(),
        operator: "equals",
        value: line.slice(separator + 1).trim(),
      });
    }

    setTargetingSaving(true);

    try {
      const saved = await onTargeting(flag, {
        roles: roles.split(",").map((value) => value.trim()).filter(Boolean),
        userIds: userIds.split(",").map((value) => value.trim()).filter(Boolean),
        rules,
      });

      if (saved === false) {
        setRoles((flag.targeting?.explicit?.roles || []).join(", "));
        setUserIds((flag.targeting?.explicit?.userIds || []).join(", "));
        setRulesText(
          (flag.targeting?.rules || [])
            .map((rule) => `${rule.field} = ${rule.value}`)
            .join("\n")
        );
      }
    } finally {
      setTargetingSaving(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);

    try {
      const response = await API.get(
        `/feature-flags/${flag._id}/versions`,
        { params: { page: 1, limit: 10 } }
      );

      setHistory(
        Array.isArray(response.data?.data) ? response.data.data : []
      );
      setHistoryOpen(true);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't load flag history"));
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="surface p-5 transition hover:border-white/[0.14] sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                flag.enabled
                  ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.55)]"
                  : "bg-slate-600"
              }`}
            />
            <h3 className="truncate text-base font-semibold text-slate-100">
              {flag.name}
            </h3>
          </div>
          <p className="mt-2 break-all font-mono text-xs text-indigo-300">
            {flag.key}
          </p>
        </div>

        <button
          type="button"
          disabled={!canToggle}
          title={
            canToggle
              ? flag.environment === "prod"
                ? "Production toggle requires approval for Developers"
                : flag.enabled
                  ? "Disable flag"
                  : "Enable flag"
              : "Your role cannot toggle this flag"
          }
          aria-label={`${flag.enabled ? "Disable" : "Enable"} ${flag.name}`}
          aria-pressed={flag.enabled}
          onClick={() => onToggle(flag)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
            flag.enabled ? "bg-emerald-500" : "bg-slate-700"
          }`}
        >
          <span
            className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${
              flag.enabled ? "left-6" : "left-1"
            }`}
          />
        </button>
      </div>

      <p className="mt-4 min-h-10 text-sm leading-5 text-slate-500">
        {flag.description || "No description added for this flag."}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary !py-1.5 text-[11px]"
          disabled={!canCopy}
          onClick={() => onCopyEnvironment(flag)}
          title="Create a disabled copy in the other environment; Production copies require approval for Developers"
        >
          Copy to {flag.environment === "prod" ? "Development" : "Production"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-wider ${
            flag.environment === "prod"
              ? "border-amber-400/20 bg-amber-400/[0.06] text-amber-200"
              : "border-sky-400/20 bg-sky-400/[0.06] text-sky-200"
          }`}
        >
          {flag.environment || "dev"}
        </span>

        <span className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-slate-500">
          {flag.type || "boolean"}
        </span>

        <span className="ml-auto text-xs text-slate-500">
          {flag.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      <RolloutSlider
        flag={flag}
        onCommit={onRollout}
        disabled={!canConfigure}
      />

      {flag.enabled && Number(flag.rolloutPercentage || 0) === 0 && (
        <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs leading-5 text-amber-100">
          Rollout is 0%, so percentage-based delivery is off. Explicit User ID
          or Role targets can still receive the flag; attribute rules only
          filter percentage rollout and do not bypass 0%.
        </p>
      )}

      <div className="mt-5 border-t border-white/[0.07] pt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-slate-300">Targeting</p>
          <span className="text-right text-[11px] text-slate-600">
            Roles / IDs: comma separated · Rules: one per line
          </span>
        </div>

        <label
          className="mb-1 block text-[11px] text-slate-500"
          htmlFor={`roles-${flag._id}`}
        >
          Explicit role targets
        </label>
        <input
          id={`roles-${flag._id}`}
          className="input-control !py-2 font-mono text-xs"
          placeholder="e.g. beta_tester, admin"
          disabled={!canConfigure}
          value={roles}
          onChange={(e) => setRoles(e.target.value)}
        />
        <p className="mt-1 text-[11px] leading-4 text-slate-600">
          Examples only. Leave blank when no role override is needed.
        </p>

        <label
          className="mb-1 mt-3 block text-[11px] text-slate-500"
          htmlFor={`users-${flag._id}`}
        >
          Explicit user ID targets
        </label>
        <input
          id={`users-${flag._id}`}
          className="input-control !py-2 font-mono text-xs"
          placeholder="e.g. user_123, user_456"
          disabled={!canConfigure}
          value={userIds}
          onChange={(e) => setUserIds(e.target.value)}
        />
        <p className="mt-1 text-[11px] leading-4 text-slate-600">
          Examples only. Leave blank when no user override is needed.
        </p>

        <label
          className="mb-1 mt-3 block text-[11px] text-slate-500"
          htmlFor={`rules-${flag._id}`}
        >
          Attribute rules{" "}
          <span className="text-slate-600">(all lines must match)</span>
        </label>
        <textarea
          id={`rules-${flag._id}`}
          rows={2}
          className="input-control resize-y !py-2 font-mono text-xs"
          placeholder={"country = IN\nplan.tier = pro"}
          disabled={!canConfigure}
          value={rulesText}
          onChange={(e) => setRulesText(e.target.value)}
        />
        <p className="mt-1 text-[11px] leading-4 text-slate-600">
          All rules must match. Equality checks support nested attributes, for
          example <code>plan.tier = pro</code>. Rules narrow percentage
          rollout; they do not override a 0% rollout.
        </p>

        {canConfigure && (
          <button
            type="button"
            disabled={targetingSaving}
            onClick={saveTargeting}
            className="btn-secondary mt-3 w-full !py-2 text-xs"
          >
            {targetingSaving ? "Saving targeting…" : "Save targeting"}
          </button>
        )}

        <div className="mt-4 border-t border-white/[0.07] pt-3">
          <button
            type="button"
            disabled={historyLoading}
            onClick={historyOpen ? () => setHistoryOpen(false) : loadHistory}
            className="btn-secondary w-full !py-2 text-xs"
          >
            {historyLoading
              ? "Loading history…"
              : historyOpen
                ? "Hide version history"
                : "View version history"}
          </button>

          {historyOpen && (
            <div className="mt-3 space-y-2">
              {history.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 p-3 text-xs text-slate-500">
                  No history recorded yet.
                </p>
              ) : (
                history.map((version) => {
                  const restorable =
                    version.snapshot &&
                    typeof version.snapshot.enabled === "boolean" &&
                    version.snapshot.key;

                  return (
                    <div
                      key={version.versionId}
                      className="rounded-xl border border-white/[0.07] bg-[#0e0e10] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-200">
                            {version.action.replaceAll("_", " ")}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {version.createdAt
                              ? new Date(version.createdAt).toLocaleString()
                              : "Unknown time"}
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-slate-600">
                            by {String(version.changedBy || "system")}
                          </p>
                        </div>

                        <button
                          type="button"
                          disabled={
                            !canManage ||
                            !restorable ||
                            rollbackVersion === version.versionId
                          }
                          title={
                            !restorable
                              ? "This legacy entry has no full flag snapshot"
                              : !canManage
                                ? "Only admins can restore a version"
                                : "Restore this snapshot"
                          }
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Restore ${flag.key} to the snapshot from ${new Date(version.createdAt).toLocaleString()}?`
                              )
                            ) {
                              return;
                            }

                            setRollbackVersion(version.versionId);

                            try {
                              await onRollback(flag, version.versionId);
                              await loadHistory();
                            } finally {
                              setRollbackVersion("");
                            }
                          }}
                          className="rounded-lg border border-white/10 px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {rollbackVersion === version.versionId
                            ? "Restoring…"
                            : "Restore"}
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span>
                          {version.snapshot?.enabled ? "Enabled" : "Disabled"}
                        </span>
                        <span>·</span>
                        <span>
                          {version.snapshot?.rolloutPercentage ?? "—"}% rollout
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </motion.article>
  );
}

function Dashboard() {
  const { project } = useContext(AuthContext);

  const [flags, setFlags] = useState([]);
  const [env, setEnv] = useState("dev");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const canManage =
    project?.role === "owner" || project?.role === "admin";

  const isDeveloper = project?.role === "developer";
  const canConfigure = canManage || isDeveloper;
  const canToggle = canManage || isDeveloper;
  const canCreate = canManage || (isDeveloper && env === "dev");
  const canCopy = canManage || isDeveloper;

  const fetchFlags = useCallback(async () => {
    setLoading(true);

    try {
      const res = await API.get("/feature-flags", {
        params: { environment: env },
      });

      const data = Array.isArray(res.data?.data) ? res.data.data : [];
      setFlags(data);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to load feature flags"));
    } finally {
      setLoading(false);
    }
  }, [env]);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const counts = useMemo(
    () => ({
      total: flags.length,
      enabled: flags.filter((flag) => flag.enabled).length,
      rollout: flags.filter(
        (flag) =>
          flag.rolloutPercentage > 0 && flag.rolloutPercentage < 100
      ).length,
      disabled: flags.filter((flag) => !flag.enabled).length,
    }),
    [flags]
  );

  const filteredFlags = flags.filter((flag) =>
    `${flag.name} ${flag.key} ${flag.description || ""}`
      .toLowerCase()
      .includes(search.toLowerCase().trim())
  );

  const patchFlagFromServer = (serverFlag) =>
    setFlags((previous) =>
      previous.map((flag) =>
        flag._id === serverFlag._id ? serverFlag : flag
      )
    );

  const createFlag = async (form) => {
    try {
      await API.post("/feature-flags", {
        ...form,
        rolloutPercentage: Number(form.rolloutPercentage),
        enabled: false,
      });

      toast.success("Feature flag created");
      setShowCreate(false);
      await fetchFlags();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't create feature flag"));
      throw err;
    }
  };

  const toggleFlag = async (flag) => {
    try {
      const response = await API.put(`/feature-flags/${flag._id}`, {
        enabled: !flag.enabled,
      });

      if (response.status === 202) {
        toast.success("Production toggle submitted for approval");
        return;
      }

      patchFlagFromServer(response.data.data);
      toast.success(`Flag ${!flag.enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't update flag"));
    }
  };

  const updateRollout = async (flag, rolloutPercentage) => {
    try {
      const response = await API.patch(
        `/feature-flags/${flag._id}/settings`,
        { rolloutPercentage }
      );

      if (response.status === 202) {
        toast.success("Production rollout change submitted for approval");
        return false;
      }

      patchFlagFromServer(response.data.data);
      toast.success("Rollout updated");
      return true;
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't update rollout"));
      throw err;
    }
  };

  const updateTargeting = async (flag, targeting) => {
    try {
      const response = await API.put(
        `/feature-flags/${flag._id}/targeting`,
        {
          explicit: {
            roles: targeting.roles,
            userIds: targeting.userIds,
          },
          rules: targeting.rules,
        }
      );

      if (response.status === 202) {
        toast.success("Production targeting submitted for approval");
        return false;
      }

      patchFlagFromServer(response.data.data);
      toast.success("Targeting rules saved");
      return true;
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't save targeting"));
      throw err;
    }
  };

  const copyFlagToOtherEnvironment = async (flag) => {
    const targetEnvironment =
      flag.environment === "prod" ? "dev" : "prod";

    const label =
      targetEnvironment === "dev" ? "Development" : "Production";

    try {
      if (isDeveloper && targetEnvironment === "prod") {
        await API.post("/approvals/requests", {
          flagId: flag._id,
          action: "COPY_TO_ENVIRONMENT",
          payload: {},
        });

        toast.success("Production copy submitted for approval");
        return;
      }

      await API.post(
        `/feature-flags/${flag._id}/copy-environment`,
        { environment: targetEnvironment }
      );

      toast.success(`Created a disabled copy in ${label}`);
      setEnv(targetEnvironment);
    } catch (err) {
      toast.error(
        getErrorMessage(err, `Couldn't copy flag to ${label}`)
      );
    }
  };

  const rollbackFlag = async (flag, versionId) => {
    try {
      const response = await API.post(
        `/feature-flags/${flag._id}/rollback`,
        { versionId }
      );

      patchFlagFromServer(response.data.data);
      toast.success("Feature flag restored to the selected version");
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't restore flag version"));
      throw err;
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#09090b] text-slate-100 md:flex-row">
      <Sidebar />

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-[1500px]">
          <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <div className="eyebrow">Project / Flags</div>
              <h1 className="page-title mt-2">Feature flags</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Create flags, choose who gets a feature, and change the
                rollout without rebuilding your app.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="environment-select">
                Environment
              </label>

              <select
                id="environment-select"
                className="input-control !w-auto min-w-36"
                value={env}
                onChange={(e) => setEnv(e.target.value)}
              >
                <option value="dev">Development</option>
                <option value="prod">Production</option>
              </select>

              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="btn-primary"
                disabled={!canCreate}
                title={
                  !canCreate
                    ? "Developers can create flags only in Development"
                    : "Create a feature flag"
                }
              >
                <span aria-hidden="true">＋</span> New flag
              </button>
            </div>
          </header>

          <section
            className="mt-8 grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4"
            aria-label="Flag overview"
          >
            {[
              {
                label: "Total flags",
                value: counts.total,
                icon: "◈",
                accent: "text-indigo-300",
                note: "In this environment",
              },
              {
                label: "Enabled",
                value: counts.enabled,
                icon: "●",
                accent: "text-emerald-300",
                note: "Currently switched on",
              },
              {
                label: "Partial rollout",
                value: counts.rollout,
                icon: "◌",
                accent: "text-red-300",
                note: "Between 1% and 99%",
              },
              {
                label: "Disabled",
                value: counts.disabled,
                icon: "○",
                accent: "text-slate-300",
                note: "Currently switched off",
              },
            ].map((item) => (
              <div key={item.label} className="surface p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">
                    {item.label}
                  </span>
                  <span
                    className={`text-lg ${item.accent}`}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                </div>

                <p className="mt-3 text-3xl font-semibold tracking-tight text-white">
                  {item.value}
                </p>

                <p className="mt-1 text-[11px] text-slate-600">
                  {item.note}
                </p>
              </div>
            ))}
          </section>

          <section className="mt-8">
            <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Your flags{" "}
                  <span className="ml-1.5 rounded-md bg-white/[0.06] px-2 py-0.5 text-xs font-medium text-slate-400">
                    {filteredFlags.length}
                  </span>
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Update the flag, then check the result below.
                </p>
              </div>

              <div className="flex gap-2">
                <label className="relative block min-w-0 flex-1 sm:w-72 sm:flex-none">
                  <span
                    className="absolute left-3 top-2.5 text-slate-500"
                    aria-hidden="true"
                  >
                    ⌕
                  </span>

                  <input
                    className="input-control !pl-9"
                    type="search"
                    placeholder="Search flags or keys…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>

                <button
                  type="button"
                  onClick={fetchFlags}
                  disabled={loading}
                  className="btn-secondary"
                  aria-label="Refresh flags"
                >
                  ↻
                </button>
              </div>
            </div>

            {loading ? (
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {[1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="surface h-[360px] animate-pulse p-6"
                  >
                    <div className="h-4 w-1/3 rounded bg-white/5" />
                    <div className="mt-4 h-3 w-2/3 rounded bg-white/5" />
                    <div className="mt-12 h-2 rounded bg-white/5" />
                    <div className="mt-14 h-20 rounded bg-white/5" />
                  </div>
                ))}
              </div>
            ) : filteredFlags.length ? (
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {filteredFlags.map((flag) => (
                  <FlagCard
                    key={flag._id}
                    flag={flag}
                    onToggle={toggleFlag}
                    onRollout={updateRollout}
                    onTargeting={updateTargeting}
                    onRollback={rollbackFlag}
                    onCopyEnvironment={copyFlagToOtherEnvironment}
                    canManage={canManage}
                    canConfigure={canConfigure}
                    canToggle={canToggle}
                    canCopy={canCopy}
                  />
                ))}
              </div>
            ) : (
              <div className="surface flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-400/10 text-2xl text-indigo-300">
                  ◈
                </div>

                <h3 className="mt-4 text-base font-semibold text-slate-100">
                  {search
                    ? "No matching flags"
                    : "No flags in this environment yet"}
                </h3>

                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  {search
                    ? "Try another name or key."
                    : "Create a flag for a feature you want to release gradually."}
                </p>

                {!search && canCreate && (
                  <button
                    type="button"
                    className="btn-primary mt-5"
                    onClick={() => setShowCreate(true)}
                  >
                    ＋ Create your first flag
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Permissions panel removed. Backend RBAC remains unchanged. */}

          <footer className="mt-8 border-t border-white/[0.06] pt-4 text-[11px] text-slate-600">
            FlagPilot · Feature flag controls · Environment: {env}
          </footer>
        </div>
      </main>

      {showCreate && (
        <CreateFlagModal
          onClose={() => setShowCreate(false)}
          onCreate={createFlag}
          canCreate={canCreate}
          isDeveloper={isDeveloper}
          defaultEnvironment={env}
        />
      )}
    </div>
  );
}

export default Dashboard;
