/* global jest */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(() => Promise.resolve('test-fcm-token')),
  requestPermission: jest.fn(() => Promise.resolve(1)),
}));

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    disconnect: jest.fn(),
    on: jest.fn(),
  })),
}));
