import * as vscode from 'vscode';

export interface TabCompletionConfig{
    //Apikeys
    fireworksApiKey:string;
    groqApiKey:string;
    openrouterApiKey:string;
    //Model settings
    maxTokens:number;
    model:string;
    //Cache settings
    completionCacheTtlMs:number,
    completionCacheMaxEntries:number,

    lspCacheMaxEntries:number,
}


const DEFAULTS:TabCompletionConfig={
    fireworksApiKey:'',
    groqApiKey:'',
    openrouterApiKey:'',
    model:'qwen/qwen-32b',
    maxTokens:500,
    completionCacheMaxEntries:100,
    completionCacheTtlMs:30000,
    lspCacheMaxEntries:100
}

export class ConfigurationService implements vscode.Disposable{

    //explicitly null to make it a singelton instance which means one instnace used across whole application
    private static instance:ConfigurationService|null=null;
    private cachedConfig;
    private readonly disposables:vscode.Disposable[]=[];
    private readonly changeListeners:Set<(config:TabCompletionConfig)=>void>=new Set();

    private constructor(){
        //getting cached config from vscode 
        this.cachedConfig=this.loadConfig();
        this.registerConfigChangeListener();
    }


    //loading config from vscode using project name 
    private loadConfig():TabCompletionConfig{
        //getting config of current project workspace
        const config=vscode.workspace.getConfiguration('tab-completion')

        return {
            fireworksApiKey: config.get<string>('fireworksApiKey',DEFAULTS.fireworksApiKey),
            groqApiKey:config.get<string>('groqApiKey',DEFAULTS.groqApiKey),
            openrouterApiKey:config.get<string>('openrouterApiKey',DEFAULTS.openrouterApiKey),
            model:config.get<string>('model',DEFAULTS.model),
            maxTokens:config.get<number>('maxTokens',DEFAULTS.maxTokens),
            completionCacheTtlMs:config.get<number>('completionCacheTtlMs',DEFAULTS.completionCacheTtlMs),
            completionCacheMaxEntries:config.get<number>('completionCacheMaxEntries',DEFAULTS.completionCacheMaxEntries),
            lspCacheMaxEntries:config.get<number>('lspCacheMaxEntries',DEFAULTS.lspCacheMaxEntries)
        }
    }

    //method for creating a listener to check configuration change after extension activation
    private registerConfigChangeListener():void{
        //pushing that listener to disposables so that it can be disposed after extension deactivates
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e)=>{
                //event of config change on this specfic project
                if(e.affectsConfiguration('tab-completion')){
                    this.cachedConfig=this.loadConfig();//again triggering load config
                    this.notifyListeners();//notifying listeners about config change
                }
            })
        )
    }

    //notifying all listeners about the config change
    private notifyListeners():void{
        for(const listener of this.changeListeners){
            try {
                listener(this.cachedConfig);//loading newly changed config to the listenrs inside changedListeners
            } catch  {
                
            }
        }
    }

    //when config changes,adding the callback which is the config stored inside changeListeners
    //triggered from other services-->load new config-->load that new config to those new service listeners 
    onConfigChange(callback:(config:TabCompletionConfig)=>void):vscode.Disposable{
        this.changeListeners.add(callback);
        return {dispose:()=>this.changeListeners.delete(callback)};
    }
    //getters
    get model(){return this.cachedConfig.model};
    get fireworksApiKey(){return this.cachedConfig.fireworksApiKey};
    get maxTokens() {return this.cachedConfig.maxTokens}
    get openrouterApiKey(){ return this.cachedConfig.openrouterApiKey}
    get groqApiKey(){ return this.cachedConfig.groqApiKey}
    get completionCacheMaxEntries(){return this.cachedConfig.completionCacheMaxEntries};
    get completionCacheTtlMs(){return this.cachedConfig.completionCacheTtlMs};
    get lspCacheMaxEntries(){return this.cachedConfig.lspCacheMaxEntries};

    //singleton format
    static getInstance():ConfigurationService{
        if(!ConfigurationService.instance){
            ConfigurationService.instance=new ConfigurationService();

        }

        return ConfigurationService.instance;
    }

    dispose() {
        //disposing all disposables and listeners from other services
        this.disposables.forEach(d=>d.dispose());
        this.changeListeners.clear();
    }
}

//function for returning instance of  Config Service class
export function getConfig(){
    return ConfigurationService.getInstance();
}