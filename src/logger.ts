import type { Logger } from 'homebridge';
type Level='error'|'warn'|'info'|'debug';
const weight:Record<Level,number>={error:0,warn:1,info:2,debug:3};
export class PluginLogger {
  constructor(private readonly log:Logger, private readonly level:Level='info'){}
  private enabled(level:Level){ return weight[level] <= weight[this.level]; }
  error(message:string,...args:unknown[]){ if(this.enabled('error')) this.log.error(message,...args); }
  warn(message:string,...args:unknown[]){ if(this.enabled('warn')) this.log.warn(message,...args); }
  info(message:string,...args:unknown[]){ if(this.enabled('info')) this.log.info(message,...args); }
  debug(message:string,...args:unknown[]){ if(this.enabled('debug')) this.log.debug(message,...args); }
}
