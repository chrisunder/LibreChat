import { useEffect, useMemo, useRef } from 'react';
import { useRecoilState } from 'recoil';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import TagManager from 'react-gtm-module';
import { installCloudFrontImageRetry } from '@librechat/client';
import {
  dataService,
  getTokenHeader,
  LocalStorageKeys,
  PermissionTypes,
  Permissions,
  QueryKeys,
} from 'librechat-data-provider';
import type { MCPAuthValuesResponse, TStartupConfig, TUser } from 'librechat-data-provider';
import {
  useMCPConnectionStatusQuery,
  useMCPToolsQuery,
  useMCPServersQuery,
} from '~/data-provider';
import { cleanupTimestampedStorage } from '~/utils/timestamps';
import useSpeechSettingsInit from './useSpeechSettingsInit';
import { useHasAccess } from '~/hooks';
import store from '~/store';

export default function useAppStartup({
  startupConfig,
  user,
}: {
  startupConfig?: TStartupConfig;
  user?: TUser;
}) {
  const [defaultPreset, setDefaultPreset] = useRecoilState(store.defaultPreset);
  const queryClient = useQueryClient();
  const reconnectAttempts = useRef(new Set<string>());
  const reconnectUserId = useRef<string>();
  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });

  useSpeechSettingsInit(!!user);
  const { data: loadedServers, isLoading: serversLoading } = useMCPServersQuery({
    enabled: canUseMcp,
  });
  const reconnectServers = useMemo(
    () =>
      Object.entries(loadedServers ?? {}).filter(
        ([, server]) =>
          server.startup === true &&
          server.requiresOAuth === false &&
          Object.keys(server.customUserVars ?? {}).length > 0,
      ),
    [loadedServers],
  );
  const authValueQueries = useQueries({
    queries: reconnectServers.map(([serverName]) => ({
      queryKey: [QueryKeys.mcpAuthValues, serverName],
      queryFn: () => dataService.getMCPAuthValues(serverName),
      enabled: canUseMcp && !!user,
      staleTime: Infinity,
    })),
  });
  const { data: connectionStatus } = useMCPConnectionStatusQuery({
    enabled: canUseMcp && !!user && reconnectServers.length > 0,
  });

  useMCPToolsQuery({
    enabled:
      canUseMcp &&
      !serversLoading &&
      !!loadedServers &&
      Object.keys(loadedServers).length > 0 &&
      !!user,
  });

  useEffect(() => {
    if (!canUseMcp || !user || !connectionStatus?.success) {
      return;
    }

    if (reconnectUserId.current !== user.id) {
      reconnectAttempts.current.clear();
      reconnectUserId.current = user.id;
    }

    reconnectServers.forEach(([serverName, server], index) => {
      const state = connectionStatus.connectionStatus[serverName]?.connectionState;
      if (state !== 'disconnected' && state !== 'error') {
        return;
      }

      const authValues = authValueQueries[index]?.data as MCPAuthValuesResponse | undefined;
      const requiredVariables = Object.keys(server.customUserVars ?? {});
      if (
        !authValues?.success ||
        !requiredVariables.every((variable) => authValues.authValueFlags[variable] === true)
      ) {
        return;
      }

      const attemptKey = `${user.id}:${serverName}`;
      if (reconnectAttempts.current.has(attemptKey)) {
        return;
      }
      reconnectAttempts.current.add(attemptKey);

      void dataService
        .reinitializeMCPServer(serverName)
        .then(() =>
          Promise.all([
            queryClient.invalidateQueries([QueryKeys.mcpTools]),
            queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]),
          ]),
        )
        .catch(() => undefined);
    });
  }, [
    authValueQueries,
    canUseMcp,
    connectionStatus,
    queryClient,
    reconnectServers,
    user,
  ]);

  /** Clean up old localStorage entries on startup */
  useEffect(() => {
    cleanupTimestampedStorage();
  }, []);

  /** Set the app title */
  useEffect(() => {
    const appTitle = startupConfig?.appTitle ?? '';
    if (!appTitle) {
      return;
    }
    document.title = appTitle;
    localStorage.setItem(LocalStorageKeys.APP_TITLE, appTitle);
  }, [startupConfig]);

  /** Set the default spec's preset as default */
  useEffect(() => {
    if (defaultPreset && defaultPreset.spec != null) {
      return;
    }

    const modelSpecs = startupConfig?.modelSpecs?.list;

    if (!modelSpecs || !modelSpecs.length) {
      return;
    }

    const defaultSpec = modelSpecs.find((spec) => spec.default);

    if (!defaultSpec) {
      return;
    }

    setDefaultPreset({
      ...defaultSpec.preset,
      iconURL: defaultSpec.iconURL,
      spec: defaultSpec.name,
    });
  }, [defaultPreset, setDefaultPreset, startupConfig?.modelSpecs?.list]);

  useEffect(() => {
    return installCloudFrontImageRetry(startupConfig, { getAuthorizationHeader: getTokenHeader });
  }, [startupConfig]);

  useEffect(() => {
    if (startupConfig?.analyticsGtmId != null && typeof window.google_tag_manager === 'undefined') {
      const tagManagerArgs = {
        gtmId: startupConfig.analyticsGtmId,
      };
      TagManager.initialize(tagManagerArgs);
    }
  }, [startupConfig?.analyticsGtmId]);
}
