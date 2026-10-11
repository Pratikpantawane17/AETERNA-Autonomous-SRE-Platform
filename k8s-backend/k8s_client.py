"""
k8s_client.py — Kubernetes cluster connectivity layer.

Supports two modes:
  1. kubeconfig  — for local/dev (reads ~/.kube/config or KUBECONFIG env)
  2. in-cluster  — for production pods with a ServiceAccount

Environment variables:
  K8S_MODE            = "kubeconfig" | "incluster" (default: kubeconfig)
  K8S_KUBECONFIG_PATH = explicit path (default: ~/.kube/config)
  K8S_CONTEXT         = kubeconfig context to use (default: current-context)
  K8S_NAMESPACES      = comma-separated list of namespaces to inspect
                        (default: "default")
"""

import os
from typing import List, Optional

from kubernetes import client, config
from kubernetes.client import (
    AppsV1Api,
    AutoscalingV1Api,
    CoreV1Api,
    CustomObjectsApi,
)


class K8sClient:
    """Thin wrapper that loads credentials once and exposes typed API objects."""

    def __init__(self):
        self._mode: str = os.getenv("K8S_MODE", "kubeconfig")
        self._kubeconfig_path: str = os.getenv("K8S_KUBECONFIG_PATH", "")
        self._context: Optional[str] = os.getenv("K8S_CONTEXT") or None
        self._namespaces: List[str] = [
            ns.strip()
            for ns in os.getenv("K8S_NAMESPACES", "default").split(",")
            if ns.strip()
        ]

        self._core_v1: Optional[CoreV1Api] = None
        self._apps_v1: Optional[AppsV1Api] = None
        self._autoscaling_v1: Optional[AutoscalingV1Api] = None
        self._custom: Optional[CustomObjectsApi] = None
        self._connected: bool = False
        self._cluster_name: str = "unknown"

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    def connect(self) -> bool:
        """Load credentials and create API handles.  Returns True on success."""
        try:
            if self._mode == "incluster":
                config.load_incluster_config()
                self._cluster_name = "in-cluster"
            else:
                kubeconfig = self._kubeconfig_path or None
                config.load_kube_config(
                    config_file=kubeconfig,
                    context=self._context,
                )
                # Try to read the context name for auditability
                _, active_context = config.list_kube_config_contexts(
                    config_file=kubeconfig,
                )
                self._cluster_name = (
                    active_context.get("context", {}).get("cluster", "local")
                    if active_context
                    else "local"
                )

            self._core_v1 = CoreV1Api()
            self._apps_v1 = AppsV1Api()
            self._autoscaling_v1 = AutoscalingV1Api()
            self._custom = CustomObjectsApi()
            self._connected = True
            print(
                f"[K8s] Connected to cluster '{self._cluster_name}' "
                f"(mode={self._mode}, namespaces={self._namespaces})"
            )
            return True

        except Exception as exc:
            print(f"[K8s] Connection failed: {exc}")
            self._connected = False
            return False

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def cluster_name(self) -> str:
        return self._cluster_name

    @property
    def namespaces(self) -> List[str]:
        return list(self._namespaces)

    @property
    def core_v1(self) -> CoreV1Api:
        if not self._core_v1:
            raise RuntimeError("K8sClient not connected — call connect() first")
        return self._core_v1

    @property
    def apps_v1(self) -> AppsV1Api:
        if not self._apps_v1:
            raise RuntimeError("K8sClient not connected — call connect() first")
        return self._apps_v1

    @property
    def autoscaling_v1(self) -> AutoscalingV1Api:
        if not self._autoscaling_v1:
            raise RuntimeError("K8sClient not connected — call connect() first")
        return self._autoscaling_v1

    @property
    def custom(self) -> CustomObjectsApi:
        if not self._custom:
            raise RuntimeError("K8sClient not connected — call connect() first")
        return self._custom

    # ------------------------------------------------------------------
    # Health check
    # ------------------------------------------------------------------

    def ping(self) -> bool:
        """Quick connectivity check — reads API server version."""
        try:
            version = client.VersionApi().get_code()
            print(f"[K8s] Ping OK — server {version.git_version}")
            return True
        except Exception as exc:
            print(f"[K8s] Ping failed: {exc}")
            return False

    def add_namespace(self, namespace: str):
        """Dynamically add a namespace to the watch list."""
        if namespace not in self._namespaces:
            self._namespaces.append(namespace)

    def remove_namespace(self, namespace: str):
        """Remove a namespace from the watch list."""
        if namespace in self._namespaces:
            self._namespaces.remove(namespace)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

k8s_client = K8sClient()
