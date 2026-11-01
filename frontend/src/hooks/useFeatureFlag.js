import { useEffect, useRef, useState } from "react";
import API from "../api/axios";

export const useFeatureFlag = (key, user, env, refreshTrigger) => {
  const [flag, setFlag] = useState(null);
  const [loading, setLoading] = useState(true);


  const requestIdRef = useRef(0);

  const fetchFlag = async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);

    try {
      const res = await API.post("/feature-flags/evaluate", {
        key,
        environment: env || "prod",
        userId: user?.id ? String(user.id) : null,
        attributes: {
          role: String(user?.role || "user"),
        },
      });

      if (requestId !== requestIdRef.current) return; // superseded, drop it
      setFlag(res.data.data);
    } catch  {
      if (requestId !== requestIdRef.current) return;
      setFlag({ enabled: false, value: false, variant: "control", reason: "EVALUATION_ERROR" });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!key) {
      setFlag(null);
      setLoading(false);
      return;
    }
    fetchFlag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, user?.id, user?.role, env, refreshTrigger]);

  return { flag, loading, refetch: fetchFlag };
};