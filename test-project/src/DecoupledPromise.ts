export class DecoupledPromise< SUCCESS, ERROR = string >{
  fine!: ( success: SUCCESS ) => void
  fail!: ( error: ERROR ) => void
  promise: Promise< SUCCESS >
  constructor(){
    this.promise = new Promise< SUCCESS >(
      ( fine, fail:( error:ERROR ) => void ) => {
        this.fine = fine
        this.fail = fail
      } ) } }
