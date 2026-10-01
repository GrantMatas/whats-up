/** Small independent work lanes. A saturated lane cannot create unbounded promises. */
export class WorkQueue {
  private active=0;private waiting:{run:()=>void;reject:(error:Error)=>void}[]=[];
  constructor(readonly name:string,readonly concurrency:number,readonly capacity=50){}
  get stats(){return {active:this.active,waiting:this.waiting.length};}
  run<T>(operation:()=>Promise<T>,signal?:AbortSignal):Promise<T> {
    if(this.waiting.length>=this.capacity)return Promise.reject(Error(`${this.name} queue is full`));
    return new Promise<T>((resolve,reject)=>{
      const run=()=>{if(signal?.aborted){reject(signal.reason);this.pump();return;}this.active++;void Promise.resolve().then(operation).then(resolve,reject).finally(()=>{this.active--;this.pump();});};
      if(this.active<this.concurrency)run();else this.waiting.push({run,reject});
    });
  }
  private pump(){while(this.active<this.concurrency&&this.waiting.length)this.waiting.shift()!.run();}
}
