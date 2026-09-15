import { describe, it, expect } from 'vitest';
import { Player } from '../../src/core/game/Player';
import { GameEngine } from '../../src/core/game/GameEngine';

describe('Host Admin Immutability Guarantee', () => {
  it('enforces that host player always has isAdmin=true and cannot be demoted', () => {
    const host = new Player({
      id: 'host_player_1',
      name: 'HostMaster',
      team: 'red',
      isHost: true,
      isAdmin: true
    });

    expect(host.isHost).toBe(true);
    expect(host.isAdmin).toBe(true);

    // Attempting to remove admin from host must be blocked
    host.isAdmin = false;
    expect(host.isAdmin).toBe(true);

    // Even if initialized without explicit isAdmin, host defaults to admin
    const hostDefault = new Player({
      id: 'host_player_2',
      name: 'HostAuto',
      team: 'blue',
      isHost: true
    });
    expect(hostDefault.isAdmin).toBe(true);
    hostDefault.isAdmin = false;
    expect(hostDefault.isAdmin).toBe(true);
  });

  it('allows non-host players to have admin granted and revoked', () => {
    const regularPlayer = new Player({
      id: 'client_1',
      name: 'Regular',
      team: 'blue',
      isHost: false,
      isAdmin: false
    });

    expect(regularPlayer.isHost).toBe(false);
    expect(regularPlayer.isAdmin).toBe(false);

    // Promote to admin
    regularPlayer.isAdmin = true;
    expect(regularPlayer.isAdmin).toBe(true);

    // Revoke admin
    regularPlayer.isAdmin = false;
    expect(regularPlayer.isAdmin).toBe(false);
  });

  it('serializes isAdmin correctly with JSON.stringify for network synchronization', () => {
    const host = new Player({
      id: 'host_1',
      name: 'Host',
      team: 'red',
      isHost: true
    });

    const client = new Player({
      id: 'client_1',
      name: 'Client',
      team: 'blue',
      isHost: false,
      isAdmin: false
    });

    // Test JSON.stringify directly
    const hostJson = JSON.parse(JSON.stringify(host));
    expect(hostJson.isHost).toBe(true);
    expect(hostJson.isAdmin).toBe(true);

    const clientJson = JSON.parse(JSON.stringify(client));
    expect(clientJson.isHost).toBe(false);
    expect(clientJson.isAdmin).toBe(false);

    // Test in array serialization (used by team_sync / syncPlayersWithClients)
    const playersArray = [host, client];
    const arrayJson = JSON.parse(JSON.stringify(playersArray));
    expect(arrayJson[0].isAdmin).toBe(true);
    expect(arrayJson[0].isHost).toBe(true);
    expect(arrayJson[1].isAdmin).toBe(false);
    expect(arrayJson[1].isHost).toBe(false);
  });

  it('preserves host admin immutability inside GameEngine', () => {
    const engine = new GameEngine();
    const host = new Player({ id: 'h1', name: 'Host', team: 'red', isHost: true });
    const peer = new Player({ id: 'p1', name: 'Peer', team: 'blue', isHost: false, isAdmin: false });

    engine.addPlayer(host);
    engine.addPlayer(peer);

    expect(engine.players.get('h1')?.isAdmin).toBe(true);
    expect(engine.players.get('p1')?.isAdmin).toBe(false);

    // Try modifying directly
    const engineHost = engine.players.get('h1')!;
    engineHost.isAdmin = false;
    expect(engineHost.isAdmin).toBe(true);

    // Non-host can be promoted and demoted
    const enginePeer = engine.players.get('p1')!;
    enginePeer.isAdmin = true;
    expect(enginePeer.isAdmin).toBe(true);
    enginePeer.isAdmin = false;
    expect(enginePeer.isAdmin).toBe(false);
  });
});
