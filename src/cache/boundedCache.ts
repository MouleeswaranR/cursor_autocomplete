interface CacheEntry<V>{
    value:V;
    expiresAt:number|null;
    groupKey:string|null;
    lastAccessed:number;
    accessCount:number;
}

//create a cache key
export function buildCacheKey(...parts:Array<string|number>):string{
    let key='';

    for(const part of parts){
        const typePrefix=typeof part==='number'?'n':'s';
        const value=new String(part);
        key+=`${typePrefix}${value.length}:${value}|`;
    }

    return key;
}


export class BoundedCache<V>{
    private cache:Map<string,CacheEntry<V>>=new Map();
    private groupIndex:Map<string,Set<string>>=new Map();

    constructor(private readonly maxSize:number){
        if(maxSize<1){
            throw new Error('Max size should be atleast one');
        }
    }

    get(key:string):V|undefined{
        const entry=this.cache.get(key);
        const now=Date.now();

        //if there is no entry for the key,return
        if(!entry){
            return undefined;
        }

        //if Time to live for entry exceeds limit,delete that entry
        if(entry.expiresAt!==null && now>entry.expiresAt){
            this.deleteEntry(key,entry);
            return undefined;
        }

        //update last accessed ime, increase access count
        entry.lastAccessed=Date.now();
        entry.accessCount++;
        return entry.value;
    }

    set(key:string,value:V,options?:{
        ttlMs?:number|null;
        groupkey?:string|null
    }):void{ 
        const existing=this.cache.get(key);//getting entry from the cache
        const ttlMs=options?.ttlMs??null;
        const groupKey=options?.groupkey??null;

        const now=Date.now();
        //if alreay exits delete the old one
        if(existing){
            this.deleteEntry(key,existing);
        }

        //check if cache size went beyound maxsize limit

        while(this.cache.size>=this.maxSize){
            this.evictLeastUsed();
        } 

        //new cache entry
        const entry:CacheEntry<V>={
            value,
            expiresAt:ttlMs!==null?now+ttlMs:null,
            lastAccessed:now,
            accessCount:1,
            groupKey,
        }

        //setting cache  with key
        this.cache.set(key,entry);

        //adding that key to groupIndex
        if(groupKey!==null){
            //getting keys of groupIndex for groupKey if already exists
            let keys=this.groupIndex.get(groupKey);
            //idf there is now keys for that groupKey, adding a new Set and adding groupKey
            if(!keys){
                keys=new Set();
                this.groupIndex.set(groupKey,keys);
            }
            keys.add(key);
        }
    }

    //combination of LRU and LFU
    private evictLeastUsed():void{
        const now=Date.now();

        let evictKey:string|null=null;
        let lowestScore=Infinity;

        for(const [key,entry] of this.cache){

            //if expiry time for cache extry is finished,remove that entry
            if(entry.expiresAt!==null && now>entry.expiresAt){
                this.deleteEntry(key,entry);
                return;
            }

            const ageInSeconds=Math.max(1,(now-entry.lastAccessed)/1000);//using 1 second if now==lastaccessed. //LRU
            const accessCount=entry.accessCount;//LFU

            //calulating a score
            const score=accessCount/ageInSeconds;

            //if currentscore < lowest score, eveict that current key
            if(score<lowestScore){
                lowestScore=score;
                evictKey=key;
            }


            if(evictKey!==null){
                //getting the entry of evicted key a deleteing it
                const entry=this.cache.get(evictKey);
                if(entry){
                    this.deleteEntry(evictKey,entry);
                }
            }
        }
    }

    //deleting entry from cache
    private deleteEntry(key:string,entry:CacheEntry<V>):void{
        this.cache.delete(key);//delte cache entry

        //deleting the key from the groupIndex
        if(entry.groupKey!==null){
            const keys=this.groupIndex.get(entry.groupKey);
            if(keys){
                keys.delete(key);

                //after deleting key, if groupindex is emoty remove that groupindex
                if(keys.size===0){
                    this.groupIndex.delete(entry.groupKey);
                }
            }
        }
    }

    //removing an group completely
    invalidateGroup(groupKey:string):number{

        //getting the keys using groupKey(document Uri)
        const keys=this.groupIndex.get(groupKey);

        let count=0;
        if(!keys)return 0;

        //iterating over cache and deleting content of the cache for groupkey
        for(const key of keys){
            if(this.cache.delete(key)){
                count++;
            }
        }

        //deleteing from groupIndex
        this.groupIndex.delete(groupKey);
        return count;
    }

    //clearing cache and groupIndex
    clear():void{
        this.cache.clear();
        this.groupIndex.clear();
    }
}