"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigurationService = void 0;
exports.getConfig = getConfig;
const vscode = __importStar(require("vscode"));
const DEFAULTS = {
    fireworksApiKey: '',
    groqApiKey: '',
    openrouterApiKey: '',
    model: 'qwen/qwen-32b',
    maxTokens: 500,
    completionCacheMaxEntries: 100,
    completionCacheTtlMs: 30000
};
class ConfigurationService {
    //explicitly null to make it a singelton instance which means one instnace used across whole application
    static instance = null;
    cachedConfig;
    disposables = [];
    changeListeners = new Set();
    constructor() {
        //getting cached config from vscode 
        this.cachedConfig = this.loadConfig();
        this.registerConfigChangeListener();
    }
    //loading config from vscode using project name 
    loadConfig() {
        //getting config of current project workspace
        const config = vscode.workspace.getConfiguration('tab-completion');
        return {
            fireworksApiKey: config.get('fireworksApiKey', DEFAULTS.fireworksApiKey),
            groqApiKey: config.get('groqApiKey', DEFAULTS.groqApiKey),
            openrouterApiKey: config.get('openrouterApiKey', DEFAULTS.openrouterApiKey),
            model: config.get('model', DEFAULTS.model),
            maxTokens: config.get('maxTokens', DEFAULTS.maxTokens),
            completionCacheTtlMs: config.get('completionCacheTtlMs', DEFAULTS.completionCacheTtlMs),
            completionCacheMaxEntries: config.get('completionCacheMaxEntries', DEFAULTS.completionCacheMaxEntries)
        };
    }
    //method for creating a listener to check configuration change after extension activation
    registerConfigChangeListener() {
        //pushing that listener to disposables so that it can be disposed after extension deactivates
        this.disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
            //event of config change on this specfic project
            if (e.affectsConfiguration('tab-completion')) {
                this.cachedConfig = this.loadConfig(); //again triggering load config
                this.notifyListeners(); //notifying listeners about config change
            }
        }));
    }
    //notifying all listeners about the config change
    notifyListeners() {
        for (const listener of this.changeListeners) {
            try {
                listener(this.cachedConfig); //loading newly changed config to the listenrs inside changedListeners
            }
            catch {
            }
        }
    }
    //when config changes,adding the callback which is the config stored inside changeListeners
    //triggered from other services-->load new config-->load that new config to those new service listeners 
    onConfigChange(callback) {
        this.changeListeners.add(callback);
        return { dispose: () => this.changeListeners.delete(callback) };
    }
    //getters
    get model() { return this.cachedConfig.model; }
    ;
    get fireworksApiKey() { return this.cachedConfig.fireworksApiKey; }
    ;
    get maxTokens() { return this.cachedConfig.maxTokens; }
    get openrouterApiKey() { return this.cachedConfig.openrouterApiKey; }
    get groqApiKey() { return this.cachedConfig.groqApiKey; }
    get completionCacheMaxEntries() { return this.cachedConfig.completionCacheMaxEntries; }
    ;
    get completionCacheTtlMs() { return this.cachedConfig.completionCacheTtlMs; }
    ;
    //singleton format
    static getInstance() {
        if (!ConfigurationService.instance) {
            ConfigurationService.instance = new ConfigurationService();
        }
        return ConfigurationService.instance;
    }
    dispose() {
        //disposing all disposables and listeners from other services
        this.disposables.forEach(d => d.dispose());
        this.changeListeners.clear();
    }
}
exports.ConfigurationService = ConfigurationService;
//function for returning instance of  Config Service class
function getConfig() {
    return ConfigurationService.getInstance();
}
//# sourceMappingURL=configurationService.js.map