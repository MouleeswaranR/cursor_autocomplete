import * as vscode from 'vscode';
import { getConfig } from '../services/configurationService';
import { ChatMessage, ChatStreamChunk } from '../utils/types';


export type ApiProvider='openrouter'|'groq'|'fireworks';

interface ProviderConfig{
    endpoint:string;
    getApiKey:()=>string;
    getModel:()=>string;
} 

const PROVIDER_CONFIGS:Record<ApiProvider,ProviderConfig>={
    openrouter:{
        endpoint:'https://openrouter.ai/api/v1/chat/completions',
        getApiKey:()=>getConfig().openrouterApiKey ,
        getModel: ()=>getConfig().model,
    },
    groq:{
        endpoint:'https://openrouter.ai/api/v1/chat/completions',
        getApiKey:()=>getConfig().groqApiKey,
        getModel:()=>getConfig().model,
    },
    fireworks:{
        endpoint:'https://openrouter.ai/api/v1/chat/completions',
        getApiKey:()=>getConfig().fireworksApiKey,
        getModel:()=>getConfig().model,
    },
}



export class ApiClient implements vscode.Disposable{

    private readonly outputChannel: vscode.OutputChannel;
    private pendingRequest: AbortController|null=null;

    constructor(outputChannel: vscode.OutputChannel){
        this.outputChannel=outputChannel;
    }

    //getting current LLM provider
    getActiveProvider():ApiProvider|null{
        const config=getConfig();
        if(config.openrouterApiKey)return 'openrouter';
        if(config.groqApiKey)return 'groq';
        if(config.fireworksApiKey)return 'fireworks';

        return null;

    }

    async complete(messages:ChatMessage[]):Promise<AsyncGenerator<string,void,unknown>>{
        const provider=this.getActiveProvider();//getting current model provider
        if(!provider){
            throw new Error('No Api Key configured');
        }

        this.cancel();//cancelling current request
        this.pendingRequest=new AbortController();//after cancelling , initializing a new instance for aborting next request

        //configService providers all providers api key, modle name, maxtokens and helper functions
        const configService=getConfig();
        
        //Max token configured 
        const maxTokens=configService.maxTokens;

        //provider config- api key,model name,endpoint
        const providerConfig=PROVIDER_CONFIGS[provider];

        const model=providerConfig.getModel();

        //body for streaming request
        const body:Record<string,unknown>={
            model,
            messages,
            max_tokens:maxTokens,
            stream:true,
            temperature:0.1
        }

        this.log(`[${provider}]  Request: model ${model} Max_tokens: ${maxTokens}`);

        
        return this.streamRequest(
            providerConfig.endpoint,
            providerConfig.getApiKey(),
            this.pendingRequest.signal,
            body
        )
    }

    //cancelling current request
    cancel():void
    {
        if(this.pendingRequest){
            this.pendingRequest.abort();//aborting current request
            this.pendingRequest=null
        }
    }    
        
    //function for streaming response from LLM
    private async* streamRequest(
        endpoint:string,
        apiKey:string,
        signal:AbortSignal,
        body:Record<string,unknown>,    
    ):AsyncGenerator<string,void,unknown>{

        //fetching response using traditional js etch
        const response=await fetch(
            endpoint,
           {
            method: 'POST',
            headers:{
                'Authorization':`Bearer ${apiKey}`,
                'Content-Type':'application/json'
            },
             body: JSON.stringify(body),
             signal
           },  
        );

        //if response is not ok, which means an api error
        if(!response.ok){
            const errorText=await response.text();
            throw new Error(`API Error ${response.status} :${errorText}`)
        }

        //if response has no body, no output from LLM
        if(!response.body){
            throw new Error('No response Body found');
        }

        //reading response body 
        const reader=response.body.getReader();//read incoming data chunk by chunk
        const decoder=new TextDecoder();//text decoder for streaming output. Converts binary data → readable text
        let buffer='';

        try{
            while(true){
                //reading streaming output using stream reader
                const {done,value}=await reader.read();
                //if done,break out
                if(done){
                    break;
                }
                //decode stream output and add it to buffer
                buffer+=decoder.decode(value,{stream:true})
                
                //splitting lines based on newline
                const lines=buffer.split('\n');
                

                //resetting buffer
                buffer=lines.pop()||'';


                for(const line of lines){
                    //checking f line starts with "data: " which means the output from LLM
                    if(line.startsWith("data: ")){
                        const data=line.slice(6);//removing "data: " and getting other output
                        //if data is DONE, output from LLM is finished
                        if(data=='[DONE]'){
                            return;
                        }
                        try{
                            //parsing the data from LLM
                            const chunk=JSON.parse(data) as ChatStreamChunk;
                            if(chunk.choices && chunk.choices.length>0){
                                //taking first choice from LLM output
                                const content=chunk.choices[0].delta?.content;
                                if(content){
                                    this.log(content);
                                    yield content;
                                 }
                            }
                        }catch(error){
                            this.log(`Parse error: ${error}`)
                        }
                    }
                }

            }
        }finally{
            reader.releaseLock();//releasing reader to allow stream reader for next request
        }

    };

    private log(message:string):void{
        this.outputChannel.appendLine(`[APIClient] ${message}`)
    }

    dispose() {
        this.cancel();
    }

}