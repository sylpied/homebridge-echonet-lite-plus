import {EchonetLitePlatform} from './platform';
import {MraRepository} from './mra';

describe('ECHONET Lite property handling',()=>{
  const platform=Object.create(EchonetLitePlatform.prototype) as any;

  test('parses list and bitmap property maps',()=>{
    expect(Object.keys(platform.propertyRequests('0380b0b3'))).toEqual(['80','b0','b3']);
    expect(Object.keys(platform.propertyRequests(`1040${'00'.repeat(15)}`))).toEqual(['e0']);
  });

  test('requests energy conversion dependencies with cumulative energy',()=>{
    platform.config={deviceSettings:[{id:'meter',properties:['e0']}]};
    expect(platform.selectedDetails('meter',{d3:'00000001',e0:'00000064',e1:'00',e7:'00000100'})).toEqual({d3:'00000001',e0:'00000064',e1:'00'});
  });

  test('applies Apple Home meter compatibility rules',()=>{
    platform.config={meterDisplayMode:'appleHome'};
    expect(platform.meterAllowed('028801')).toBe(false);
    expect(platform.meterAllowed('028101')).toBe(true);
    platform.config={meterDisplayMode:'extended'};
    expect(platform.meterAllowed('028801')).toBe(true);
  });

  test('ignores empty SET response values',()=>{
    platform.mra=new MraRepository();
    expect(platform.decodedDetails('013001',{b3:'',bb:'1a'})).toEqual({roomTemperature:26});
  });
});
