import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PeerConnection } from '../../src/net/transport/PeerConnection';

describe('PeerConnection ICE Candidate Queue and DataChannel', () => {
  let mockPc: any;
  let mockDataChannel: any;

  beforeEach(() => {
    mockDataChannel = {
      label: 'game',
      readyState: 'open',
      binaryType: '',
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onclose: null,
      onmessage: null
    };

    mockPc = {
      remoteDescription: null,
      localDescription: null,
      iceConnectionState: 'new',
      connectionState: 'new',
      createDataChannel: vi.fn(() => mockDataChannel),
      createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'dummy-offer-sdp' })),
      createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'dummy-answer-sdp' })),
      setLocalDescription: vi.fn(async (desc) => { mockPc.localDescription = desc; }),
      setRemoteDescription: vi.fn(async (desc) => { mockPc.remoteDescription = desc; }),
      addIceCandidate: vi.fn(async () => {}),
      close: vi.fn(),
      onicecandidate: null,
      oniceconnectionstatechange: null,
      onconnectionstatechange: null,
      ondatachannel: null
    };

    (globalThis as any).RTCPeerConnection = vi.fn(() => mockPc);
    (globalThis as any).RTCSessionDescription = vi.fn((desc) => desc);
    (globalThis as any).RTCIceCandidate = vi.fn((cand) => cand);
  });

  it('queues remote candidates if remoteDescription is not yet set', async () => {
    const peer = new PeerConnection('peer_guest', false);

    const candidate1 = { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 };
    const candidate2 = { candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 };

    // Received before remoteDescription
    await peer.handleRemoteCandidate(candidate1);
    await peer.handleRemoteCandidate(candidate2);

    expect(mockPc.addIceCandidate).not.toHaveBeenCalled();

    // Now offer arrives and is handled
    await peer.handleOffer({ type: 'offer', sdp: 'dummy-offer-sdp' });

    // Both candidates must have been flushed and added
    expect(mockPc.addIceCandidate).toHaveBeenCalledTimes(2);
    expect(mockPc.addIceCandidate).toHaveBeenNthCalledWith(1, candidate1);
    expect(mockPc.addIceCandidate).toHaveBeenNthCalledWith(2, candidate2);
  });

  it('adds candidate directly if remoteDescription is already set', async () => {
    const peer = new PeerConnection('peer_guest', false);

    await peer.handleOffer({ type: 'offer', sdp: 'dummy-offer-sdp' });

    const candidate = { candidate: 'candidate:live', sdpMid: '0', sdpMLineIndex: 0 };
    await peer.handleRemoteCandidate(candidate);

    expect(mockPc.addIceCandidate).toHaveBeenCalledWith(candidate);
  });

  it('initiator creates dataChannel with label "game" and unordered non-retransmit config', () => {
    const peer = new PeerConnection('peer_client', true);

    expect(mockPc.createDataChannel).toHaveBeenCalledWith('game', {
      ordered: false,
      maxRetransmits: 0
    });
    expect(peer.dataChannel).toBe(mockDataChannel);
  });

  it('guest sets up dataChannel received via ondatachannel', () => {
    const peer = new PeerConnection('peer_host', false);

    expect(mockPc.createDataChannel).not.toHaveBeenCalled();
    expect(mockPc.ondatachannel).toBeDefined();

    mockPc.ondatachannel({ channel: mockDataChannel });
    expect(peer.dataChannel).toBe(mockDataChannel);
  });

  it('dispatches string messages to onReliableMessage and ArrayBuffer to onUnreliableMessage', () => {
    const peer = new PeerConnection('peer_test', true);
    const reliableSpy = vi.fn();
    const unreliableSpy = vi.fn();

    peer.onReliableMessage = reliableSpy;
    peer.onUnreliableMessage = unreliableSpy;

    // String message
    mockDataChannel.onmessage({ data: '{"type":"CLIENT_HELLO"}' });
    expect(reliableSpy).toHaveBeenCalledWith('{"type":"CLIENT_HELLO"}');
    expect(unreliableSpy).not.toHaveBeenCalled();

    // Binary message
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    mockDataChannel.onmessage({ data: buffer });
    expect(unreliableSpy).toHaveBeenCalledWith(buffer);
  });
});
