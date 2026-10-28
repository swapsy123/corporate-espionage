import {createApp} from './app.js';
const {app,db,closeWorkspaceDatabases}=createApp();
const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Levr Competitor Analysis server started.'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{closeWorkspaceDatabases();db.close();process.exit(0);}));
