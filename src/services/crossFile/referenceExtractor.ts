import * as vscode from 'vscode';
import { ASTService } from '../astService';
import { findImportLineSpans, parseImportBindings, removeLineSpans } from '../../utils/importAnalysis';
import { extractIdentifiers } from '../../utils/languageUtils';
import { extractDeclaredNames } from '../astAnalysis';


interface NearbyContext{
        referenceNames:Set<string>;
        nearByIdentifiers: Set<string>;
        declaredIdentifiers: Set<string>;
}

export class ReferenceExtractor{

    constructor(private readonly astService:ASTService){
       
    }


    extract(prefix: string,languageId:string):NearbyContext{

        //map of original imported identifers by alias names
        const {importedAliasesByOriginal}=parseImportBindings(prefix,languageId);

        //finding the import lines and getting prefix without import lines
        const importLinesSpan=findImportLineSpans(prefix,languageId);
        const prefixWithoutImports=removeLineSpans(prefix,importLinesSpan);

        //splitting prefix content
        const lines=prefixWithoutImports.split('\n');

        //getting nearby prefix content
        const nearByText=lines.slice(-15).join('\n');

        //getting identifiers in nearby content
        const nearByIdentifiers=extractIdentifiers(nearByText,languageId);

        //getting declared identifiers in prefix content
        const declaredIdentifiers=this.astService.withParsedTree(prefix,extractDeclaredNames)??new Set<string>();

        //building reference names(for imports from other files)
        const referenceNames=this.buildReferenceNames(nearByIdentifiers,importedAliasesByOriginal,declaredIdentifiers);


        return {
            referenceNames,
            nearByIdentifiers,
            declaredIdentifiers,
        }

    }

    //building reference names from import of that file  
    private buildReferenceNames(
        nearByIdentifiers:Set<string>,
        aliasesByOriginal:Map<string,Set<string>>,
        declaredIdentifiers:Set<string>
    ):Set<string>{
        const references:Set<string>=new Set();

        //mapping original imports by aliases
        const originalByAliases=new Map<string,string>();


        for(const [original,aliases] of aliasesByOriginal){
            for(const alias of aliases){
                originalByAliases.set(alias,original);
            }
        }

        for(const identifer of nearByIdentifiers){
            //if identifer already inside declared identifer , it is already used in prefix
            if(declaredIdentifiers.has(identifer)){
                continue;
            }

            //getting reference name of identifier in import ststement, lese use same same if tehre is no alias name
            const original=originalByAliases.get(identifer)??identifer;
            references.add(original);
        }

        return references;
    }
}