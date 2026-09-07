import React from 'react';
import { RecoilRoot } from 'recoil';
import { renderHook, waitFor } from '@testing-library/react';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type { TUser } from 'librechat-data-provider';

type CloudFrontRetryOptions = { getAuthorizationHeader: () => string | undefined };

const mockUseHasAccess = jest.fn();
const mockUseMCPServersQuery = jest.fn();
const mockUseMCPToolsQuery = jest.fn();
const mockUseMCPConnectionStatusQuery = jest.fn();
const mockUseQueries = jest.fn();
const mockInvalidateQueries = jest.fn();
const mockReinitializeMCPServer = jest.fn();
const mockInstallCloudFrontImageRetry = jest.fn(
  (_startupConfig: unknown, _options: CloudFrontRetryOptions): (() => void) =>
    () =>
      undefined,
);
const mockGetTokenHeader = jest.fn();

jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query');
  return {
    ...actual,
    useQueries: (config: unknown) => mockUseQueries(config),
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

jest.mock('@librechat/client', () => ({
  installCloudFrontImageRetry: (startupConfig: unknown, options: CloudFrontRetryOptions) =>
    mockInstallCloudFrontImageRetry(startupConfig, options),
}));

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      reinitializeMCPServer: (serverName: string) => mockReinitializeMCPServer(serverName),
    },
    getTokenHeader: () => mockGetTokenHeader(),
  };
});

jest.mock('~/hooks', () => ({
  useHasAccess: (args: unknown) => mockUseHasAccess(args),
}));

jest.mock('~/data-provider', () => ({
  useMCPConnectionStatusQuery: (config: unknown) => mockUseMCPConnectionStatusQuery(config),
  useMCPServersQuery: (config: unknown) => mockUseMCPServersQuery(config),
  useMCPToolsQuery: (config: unknown) => mockUseMCPToolsQuery(config),
}));

jest.mock('../useSpeechSettingsInit', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('~/utils/timestamps', () => ({
  cleanupTimestampedStorage: jest.fn(),
}));

jest.mock('react-gtm-module', () => ({
  __esModule: true,
  default: { initialize: jest.fn() },
}));

import useAppStartup from '../useAppStartup';

const mockUser = {
  id: 'user-123',
  username: 'testuser',
  email: 'test@example.com',
  name: 'Test User',
  avatar: '',
  role: 'USER',
  provider: 'local',
  emailVerified: true,
  createdAt: '2023-01-01T00:00:00.000Z',
  updatedAt: '2023-01-01T00:00:00.000Z',
} as TUser;

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RecoilRoot>{children}</RecoilRoot>
);

describe('useAppStartup — MCP permission gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInstallCloudFrontImageRetry.mockClear();
    mockUseMCPServersQuery.mockReturnValue({ data: undefined, isLoading: false });
    mockUseMCPToolsQuery.mockReturnValue({ data: undefined, isLoading: false });
    mockUseMCPConnectionStatusQuery.mockReturnValue({ data: undefined, isLoading: false });
    mockUseQueries.mockReturnValue([]);
    mockInvalidateQueries.mockResolvedValue(undefined);
    mockReinitializeMCPServer.mockResolvedValue({ success: true });
  });

  it('checks the MCP_SERVERS.USE permission via useHasAccess', () => {
    mockUseHasAccess.mockReturnValue(false);

    renderHook(() => useAppStartup({ startupConfig: undefined, user: mockUser }), { wrapper });

    expect(mockUseHasAccess).toHaveBeenCalledWith({
      permissionType: PermissionTypes.MCP_SERVERS,
      permission: Permissions.USE,
    });
  });

  it('suppresses all MCP queries when user lacks MCP_SERVERS.USE', () => {
    mockUseHasAccess.mockReturnValue(false);

    renderHook(() => useAppStartup({ startupConfig: undefined, user: mockUser }), { wrapper });

    expect(mockUseMCPServersQuery).toHaveBeenCalledWith({ enabled: false });
    expect(mockUseMCPToolsQuery).toHaveBeenCalledWith({ enabled: false });
  });

  it('enables servers query and tools query when permission granted, servers loaded, and user present', () => {
    mockUseHasAccess.mockReturnValue(true);
    mockUseMCPServersQuery.mockReturnValue({
      data: { 'test-server': { url: 'http://test' } },
      isLoading: false,
    });

    renderHook(() => useAppStartup({ startupConfig: undefined, user: mockUser }), { wrapper });

    expect(mockUseMCPServersQuery).toHaveBeenCalledWith({ enabled: true });
    expect(mockUseMCPToolsQuery).toHaveBeenCalledWith({ enabled: true });
  });

  it('suppresses tools query when permission granted but user prop is undefined', () => {
    mockUseHasAccess.mockReturnValue(true);
    mockUseMCPServersQuery.mockReturnValue({
      data: { 'test-server': { url: 'http://test' } },
      isLoading: false,
    });

    renderHook(() => useAppStartup({ startupConfig: undefined, user: undefined }), { wrapper });

    expect(mockUseMCPServersQuery).toHaveBeenCalledWith({ enabled: true });
    expect(mockUseMCPToolsQuery).toHaveBeenCalledWith({ enabled: false });
  });

  it('suppresses tools query when permission granted but no servers loaded', () => {
    mockUseHasAccess.mockReturnValue(true);
    mockUseMCPServersQuery.mockReturnValue({ data: {}, isLoading: false });

    renderHook(() => useAppStartup({ startupConfig: undefined, user: mockUser }), { wrapper });

    expect(mockUseMCPServersQuery).toHaveBeenCalledWith({ enabled: true });
    expect(mockUseMCPToolsQuery).toHaveBeenCalledWith({ enabled: false });
  });

  it('suppresses tools query while servers are still loading', () => {
    mockUseHasAccess.mockReturnValue(true);
    mockUseMCPServersQuery.mockReturnValue({ data: undefined, isLoading: true });

    renderHook(() => useAppStartup({ startupConfig: undefined, user: mockUser }), { wrapper });

    expect(mockUseMCPToolsQuery).toHaveBeenCalledWith({ enabled: false });
  });

  it('installs CloudFront image retry from startup config', () => {
    mockUseHasAccess.mockReturnValue(false);
    const startupConfig = {
      cloudFront: {
        cookieRefresh: {
          endpoint: '/api/auth/cloudfront/refresh',
          domain: 'https://cdn.example.com',
        },
      },
    } as never;

    renderHook(() => useAppStartup({ startupConfig, user: mockUser }), { wrapper });

    expect(mockInstallCloudFrontImageRetry).toHaveBeenCalledWith(startupConfig, {
      getAuthorizationHeader: expect.any(Function),
    });
    const [, options] = mockInstallCloudFrontImageRetry.mock.calls[0];
    mockGetTokenHeader.mockReturnValue('Bearer app-token');

    expect(options.getAuthorizationHeader()).toBe('Bearer app-token');
    expect(mockGetTokenHeader).toHaveBeenCalledTimes(1);
  });

  it('reconnects a disconnected startup server when all user credentials are set', async () => {
    mockUseHasAccess.mockReturnValue(true);
    mockUseMCPServersQuery.mockReturnValue({
      data: {
        quinn: {
          startup: true,
          requiresOAuth: false,
          customUserVars: { QUINN_ACCESS_TOKEN: { title: 'Token', description: 'Token' } },
        },
      },
      isLoading: false,
    });
    mockUseMCPConnectionStatusQuery.mockReturnValue({
      data: {
        success: true,
        connectionStatus: {
          quinn: { connectionState: 'disconnected', requiresOAuth: false },
        },
      },
    });
    mockUseQueries.mockReturnValue([
      {
        data: {
          success: true,
          serverName: 'quinn',
          authValueFlags: { QUINN_ACCESS_TOKEN: true },
        },
      },
    ]);

    renderHook(() => useAppStartup({ startupConfig: undefined, user: mockUser }), { wrapper });

    await waitFor(() => expect(mockReinitializeMCPServer).toHaveBeenCalledWith('quinn'));
  });

  it('does not reconnect when a required user credential is missing', () => {
    mockUseHasAccess.mockReturnValue(true);
    mockUseMCPServersQuery.mockReturnValue({
      data: {
        quinn: {
          startup: true,
          requiresOAuth: false,
          customUserVars: { QUINN_ACCESS_TOKEN: { title: 'Token', description: 'Token' } },
        },
      },
      isLoading: false,
    });
    mockUseMCPConnectionStatusQuery.mockReturnValue({
      data: {
        success: true,
        connectionStatus: {
          quinn: { connectionState: 'disconnected', requiresOAuth: false },
        },
      },
    });
    mockUseQueries.mockReturnValue([
      {
        data: {
          success: true,
          serverName: 'quinn',
          authValueFlags: { QUINN_ACCESS_TOKEN: false },
        },
      },
    ]);

    renderHook(() => useAppStartup({ startupConfig: undefined, user: mockUser }), { wrapper });

    expect(mockReinitializeMCPServer).not.toHaveBeenCalled();
  });

  it('does not reconnect an already connected server or repeat an attempted reconnect', async () => {
    mockUseHasAccess.mockReturnValue(true);
    const serverQuery = {
      data: {
        quinn: {
          startup: true,
          requiresOAuth: false,
          customUserVars: { QUINN_ACCESS_TOKEN: { title: 'Token', description: 'Token' } },
        },
      },
      isLoading: false,
    };
    mockUseMCPServersQuery.mockReturnValue(serverQuery);
    mockUseQueries.mockReturnValue([
      {
        data: {
          success: true,
          serverName: 'quinn',
          authValueFlags: { QUINN_ACCESS_TOKEN: true },
        },
      },
    ]);
    mockUseMCPConnectionStatusQuery.mockReturnValue({
      data: {
        success: true,
        connectionStatus: {
          quinn: { connectionState: 'connected', requiresOAuth: false },
        },
      },
    });
    const { rerender } = renderHook(
      () => useAppStartup({ startupConfig: undefined, user: mockUser }),
      { wrapper },
    );

    expect(mockReinitializeMCPServer).not.toHaveBeenCalled();

    mockUseMCPConnectionStatusQuery.mockReturnValue({
      data: {
        success: true,
        connectionStatus: {
          quinn: { connectionState: 'disconnected', requiresOAuth: false },
        },
      },
    });
    rerender();
    rerender();

    await waitFor(() => expect(mockReinitializeMCPServer).toHaveBeenCalledTimes(1));
  });
});
