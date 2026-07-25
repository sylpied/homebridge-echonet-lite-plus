import {MraRepository} from './mra';
describe('MRA 1.4.0 conversion',()=>{
  const mra=new MraRepository();
  test('decodes states and signed/scaled numbers',()=>{
    expect(mra.decode('013001','80','30')?.value).toBe('true');
    expect(mra.decode('013001','b0','42')?.value).toBe('cooling');
    expect(mra.decode('001101','e0','00fa')?.value).toBe(25);
  });
  test('encodes writable values',()=>{
    expect(mra.encode('013001','operationMode','heating')).toEqual({epc:'B0',edt:'43'});
    expect(mra.encode('013001','targetTemperature',25)).toEqual({epc:'B3',edt:'19'});
    expect(mra.encode('026301','openCloseOperation','open')).toEqual({epc:'E0',edt:'41'});
    expect(mra.encode('026301','degreeOfOpening',75)).toEqual({epc:'E1',edt:'4b'});
    expect(mra.encode('026b01','automaticBathOperation','true')).toEqual({epc:'E3',edt:'41'});
    expect(mra.encode('027b01','targetTemperature1',28)).toEqual({epc:'E0',edt:'1c'});
    expect(mra.encode('02a601','automaticWaterHeating','auto')).toEqual({epc:'B0',edt:'41'});
    expect(mra.encode('027301','operationSetting','drying')).toEqual({epc:'B0',edt:'40'});
  });
  test('tries every oneOf candidate and rejects invalid numeric writes',()=>{
    expect(mra.decode('013001','b3','fd')?.value).toBe('undefined');
    expect(mra.encode('013001','targetTemperature',Number.NaN)).toBeUndefined();
    expect(mra.encode('013001','targetTemperature',300)).toBeUndefined();
    expect(mra.encode('013001','targetTemperature',25.5)).toBeUndefined();
  });
  test('exposes access rules',()=>{
    expect(mra.decode('013001','bb','1a')).toMatchObject({name:'roomTemperature',readable:true,writable:false,observable:true});
  });
  test('merges access rules across duplicate release definitions',()=>{
    expect(mra.isReadable('013001','bb')).toBe(true);
    expect(mra.isWritable('013001','bb')).toBe(false);
    expect(mra.isReadable('ffff01','80')).toBe(false);
  });
});
