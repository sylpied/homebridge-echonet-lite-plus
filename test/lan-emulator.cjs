const os = require('node:os');
const EL = require('echonet-lite');

const addresses = [...new Set(Object.values(os.networkInterfaces()).flat()
  .filter((item) => item && !item.internal && (item.family === 'IPv4' || item.family === 4))
  .map((item) => item.address))];
const address = addresses[0];

if (!address) {
  throw new Error('利用可能なIPv4ネットワークが見つかりません');
}

const devices = {
  '013001': {
    '80': [0x31],
    '9d': [0x01, 0x80],
    '9e': [0x03, 0x80, 0xb0, 0xb3],
    '9f': [0x07, 0x80, 0xb0, 0xb3, 0xbb, 0x9d, 0x9e, 0x9f],
    'b0': [0x42],
    'b3': [0x19],
    'bb': [0x1a],
  },
  '029001': {
    '80': [0x31],
    '9d': [0x01, 0x80],
    '9e': [0x02, 0x80, 0xb0],
    '9f': [0x06, 0x80, 0xb0, 0x9d, 0x9e, 0x9f],
    'b0': [0x64],
  },
  '001101': {
    '9d': [0x01, 0xe0],
    '9e': [0x00],
    '9f': [0x04, 0xe0, 0x9d, 0x9e, 0x9f],
    'e0': [0x00, 0xfa],
  },
  '028801': {
    '9d': [0x00],
    '9e': [0x00],
    '9f': [0x08, 0xd3, 0xe0, 0xe1, 0xe7, 0xe8, 0x9d, 0x9e, 0x9f],
    'd3': [0x00, 0x00, 0x00, 0x01],
    'e0': [0x00, 0x00, 0x30, 0x39],
    'e1': [0x01],
    'e7': [0x00, 0x00, 0x01, 0xc2],
    'e8': [0x00, 0x7b, 0x00, 0x2d],
  },
  '028701': {
    '9d': [0x00],
    '9e': [0x00],
    '9f': [0x04, 0xb7, 0x9d, 0x9e, 0x9f],
    'b7': [0x00, 0x02, 0x00, 0x00, 0x01, 0xf4, 0x00, 0x00, 0x01, 0x2c],
  },
  '028101': {
    '9d': [0x00],
    '9e': [0x00],
    '9f': [0x06, 0xe0, 0xe1, 0xe3, 0x9d, 0x9e, 0x9f],
    'e0': [0x00, 0x00, 0x30, 0x39],
    'e1': [0x00],
    'e3': [0x42],
  },
  '028201': {
    '9d': [0x00],
    '9e': [0x00],
    '9f': [0x04, 0xe0, 0x9d, 0x9e, 0x9f],
    'e0': [0x00, 0x00, 0x10, 0xe1],
  },
};

const socket = EL.initialize(Object.keys(devices), (rinfo, packet, error) => {
  if (error) { console.error(`receive error: ${error.message || error}`); return; }
  if (!packet) return;
  console.log(`request: ${rinfo.address} ${packet.SEOJ} -> ${packet.DEOJ} ESV=${packet.ESV} ${JSON.stringify(packet.DETAILs || {})}`);
  if (packet.ESV === EL.GET) EL.replyGetDetail(rinfo, packet, devices);
  if (packet.ESV === EL.SETC || packet.ESV === EL.SETI) {
    for (const [epc, edt] of Object.entries(packet.DETAILs || {})) {
      if (devices[packet.DEOJ]?.[epc] && edt) devices[packet.DEOJ][epc] = EL.toHexArray(edt);
    }
    if (packet.ESV === EL.SETC) {
      const details = Object.keys(packet.DETAILs || {}).flatMap((epc) => [parseInt(epc, 16), 0x00]);
      EL.sendArray(rinfo, [0x10, 0x81, ...EL.toHexArray(packet.TID), ...EL.toHexArray(packet.DEOJ), ...EL.toHexArray(packet.SEOJ), 0x71, Object.keys(packet.DETAILs || {}).length, ...details]);
    }
    for (const [epc, edt] of Object.entries(packet.DETAILs || {})) {
      if (edt) EL.sendOPC1(rinfo.address, packet.DEOJ, packet.SEOJ, EL.INF, epc, edt);
    }
  }
}, 4, { v4: address, ignoreMe: true, autoGetProperties: false, debugMode: false });

const ready = () => {
  for (const candidate of addresses.slice(1)) {
    try { socket.addMembership(EL.EL_Multi, candidate); } catch (error) {
      console.error(`multicast join failed: ${candidate}: ${error.message}`);
    }
  }
  console.log(`ECHONET Lite emulator ready: ${addresses.join(', ')}:3610 (7 devices including energy, water and gas meters)`);
};
if (socket.listening) ready(); else socket.once('listening', ready);

const stop = () => { EL.release(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
