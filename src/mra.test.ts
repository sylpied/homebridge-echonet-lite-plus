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
  });
  test('tries every oneOf candidate and rejects invalid numeric writes',()=>{
    expect(mra.decode('013001','b3','fd')?.value).toBe('undefined');
    expect(mra.encode('013001','targetTemperature',Number.NaN)).toBeUndefined();
    expect(mra.encode('013001','targetTemperature',300)).toBeUndefined();
    expect(mra.encode('013001','targetTemperature',25.5)).toEqual({epc:'B3',edt:'1a'});
  });
  test('exposes access rules',()=>{
    expect(mra.decode('013001','bb','1a')).toMatchObject({name:'roomTemperature',readable:true,writable:false,observable:true});
  });
});
