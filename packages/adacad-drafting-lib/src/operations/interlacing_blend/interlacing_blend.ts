import { createCell, Draft, getHeddle, initDraftFromDrawdown, updateWarpSystemsAndShuttles, updateWeftSystemsAndShuttles, warps, wefts } from "../../draft";
import { defaults, lcm } from "../../utils";
import { clothOp } from "../categories";
import { getAllDraftsAtInlet, getOpParamValById, parseDraftNames } from "../operations";
import { NumParam, OperationInlet, OpParamVal, OpInput, Operation, OpMeta, SelectParam } from "../types";

const name="interlacing_blend";

const meta: OpMeta={
  displayname:"interlacing blend",
  desc:"Creates a new draft by placing draft A and draft B on either side of a blend region. The inputs are repeated to a common size, and the blend region transitions between them based on the selected direction, center, and length.",
  categories:[clothOp],
  advanced:true,
  old_names:["interlacing blend"]
};

//PARAMS
const blendRegionLength: NumParam={
  name:"blend region length",
  type:"number",
  min:1,
  max:10000,
  value:10,
  dx:"the length of the blend region"
};

const blendCenterPercent: NumParam={
  name:"blend center percent",
  type:"number",
  min:0,
  max:100,
  step:10,
  value:50,
  dx:"the center of the blend transition as a percent from 0 to 100"
};

const changePatternSize: NumParam={
  name:"change pattern size",
  type:"number",
  min:-10000,
  max:10000,
  value:0,
  dx:"adds to or subtracts from the common repeated pattern size"
};

const blendDirection: SelectParam={
  name:"blend direction",
  type:"select",
  value:0,
  selectlist:[
    { name:"horizontal", value:0 },
    { name:"vertical", value:1 }
  ],
  dx:"controls whether the blend runs horizontally or vertically"
};

const params=[blendRegionLength, blendCenterPercent, changePatternSize, blendDirection];

//INLETS
const draft_a: OperationInlet={
  name:"a",
  type:"static",
  value:null,
  uses:"draft",
  dx:"the first draft to blend",
  num_drafts:1
};

const draft_b: OperationInlet={
  name:"b",
  type:"static",
  value:null,
  uses:"draft",
  dx:"the second draft to blend",
  num_drafts:1
};

const inlets=[draft_a, draft_b];

//funcs
const clamp=(value:number, min:number, max:number):number=>{ // quick function to clamp values between 2 values
  if(value<min)return min;
  if(value>max)return max;
  return value;
};

const getCommonSize=(patternAOrg:Draft, patternBOrg:Draft, patternSizeChange:number)=>{ //ChatGPT
  const drafts = [patternAOrg, patternBOrg];
  const commonW = lcm(drafts.map(draft=>warps(draft.drawdown)).filter(size=>size>0), defaults.lcm_timeout)+patternSizeChange;
  const commonH = lcm(drafts.map(draft=>wefts(draft.drawdown)).filter(size=>size>0), defaults.lcm_timeout)+patternSizeChange;
  let adjustedCommonW = commonW;
  let adjustedCommonH = commonH;

  if(adjustedCommonW<1)adjustedCommonW=1;
  if(adjustedCommonH<1)adjustedCommonH=1;

  return { commonW:adjustedCommonW, commonH:adjustedCommonH };
};

const repeatPatternToSize=(patternOrg:Draft, targetH:number, targetW:number):Array<Array<boolean | null>>=>{
  let output:Array<Array<boolean | null>>=[];

  for(let i=0;i<targetH;i++){
    output[i]=[];
    for(let j=0;j<targetW;j++){
      let sourceRow=i % wefts(patternOrg.drawdown);
      let sourceCol=j % warps(patternOrg.drawdown);
      output[i][j]=getHeddle(patternOrg.drawdown, sourceRow, sourceCol);
    }
  }

  return output;
};

//main
const perform=(op_params:Array<OpParamVal>, op_inputs:Array<OpInput>)=>{
  const inputDraftA=getAllDraftsAtInlet(op_inputs, 0);
  const inputDraftB=getAllDraftsAtInlet(op_inputs, 1);
  let middleColumnCount=Math.floor(<number>getOpParamValById(0, op_params));
  if(middleColumnCount<0){
    middleColumnCount=0;
  }
  let blendCenterPercent=clamp(Math.floor(<number>getOpParamValById(1, op_params)), 0, 100);
  let changePatternSizeValue=Math.floor(<number>getOpParamValById(2, op_params));
  let isVertical=false;

  if(<number>getOpParamValById(3, op_params)===1){
    isVertical=true;
  }

  if(inputDraftA.length===0 || inputDraftB.length===0){ // need to have 2 draft inputs to run
    return Promise.resolve([]);
  }

  let rows=0;
  let cols=0;
  const patternAOrg=inputDraftA[0];
  const patternBOrg=inputDraftB[0];
  const {commonW, commonH}=getCommonSize(patternAOrg, patternBOrg, changePatternSizeValue);
  const patternA=repeatPatternToSize(patternAOrg, commonH, commonW);
  const patternB=repeatPatternToSize(patternBOrg, commonH, commonW);

  if(!isVertical){
    rows=commonH;
    cols=commonW+commonW+middleColumnCount;
  }else{
    rows=commonH+commonH+middleColumnCount;
    cols=commonW;
  }

  const horizontalPatternBStart=cols-commonW;
  const horizontalMiddleLength=horizontalPatternBStart-commonW;
  const verticalPatternBStart=rows-commonH;
  const verticalMiddleLength=verticalPatternBStart-commonH;

  let drawdown:Array<Array<any>>=[];   // create drawdown array rows x cols filled will false cells
  for(let i=0;i<rows;i++){
    drawdown[i]=[];
    for(let j=0;j<cols;j++){
      drawdown[i][j]=createCell(false);
    }
  } 
  let cellValue:boolean | null=false;

  if(!isVertical){
    const fullTileCount=Math.floor(horizontalMiddleLength/commonW);
    const remainder=horizontalMiddleLength%commonW;
    const leftFullTileCount=Math.floor(fullTileCount/2);
    const leftFullWidth=leftFullTileCount*commonW;
    const remainderStart=leftFullWidth;
    const remainderEnd=remainderStart+remainder;
    let center=0;
    if(fullTileCount>0){
      center=(blendCenterPercent/100)*(fullTileCount-1);
    }

    for(let i=0;i<rows;i++){
      for(let j=0;j<cols;j++){
        if(j<commonW){
          cellValue=patternA[i][j];
        }
        else if(j>=horizontalPatternBStart){
          const patternBCol=j-horizontalPatternBStart;
          cellValue=patternB[i][patternBCol];
        }
        else if(j>=commonW && j<horizontalPatternBStart){
          const middleCol=j-commonW;
          let usePatternA=false;

          if(middleCol>=remainderStart && middleCol<remainderEnd){
            const remainderCol=middleCol-remainderStart;
            usePatternA=(remainderCol%2===0);
          }else{
            let tileIndex=0;
            let colInTile=0;

            if(middleCol<remainderStart){
              tileIndex=Math.floor(middleCol/commonW);
              colInTile=middleCol%commonW;
            }else{
              const rightCol=middleCol-remainderEnd;
              tileIndex=leftFullTileCount+Math.floor(rightCol/commonW);
              colInTile=rightCol%commonW;
            }

            let distance=Math.floor(Math.abs(tileIndex-center));
            const isPatternASide=tileIndex<center;
            const isPatternBSide=tileIndex>center;
            const stripeSpacing=2+distance;
            let useOpposite=((colInTile+1)%stripeSpacing===0);

            if(!isPatternASide && !isPatternBSide){
              usePatternA=(colInTile%2===0);
            }else if(isPatternASide){
              usePatternA=!useOpposite;
            }else{
              usePatternA=useOpposite;
            }

            if(usePatternA){
              cellValue=patternA[i][colInTile];
            }else{
              cellValue=patternB[i][colInTile];
            }
          }

          if(middleCol>=remainderStart && middleCol<remainderEnd){
            const centerCol=(middleCol-remainderStart)%commonW;
            if(usePatternA){
              cellValue=patternA[i][centerCol];
            }else{
              cellValue=patternB[i][centerCol];
            }
          }
        }

        drawdown[i][j]=createCell(cellValue);
      }
    }
  }
  else{
    const fullTileCount=Math.floor(verticalMiddleLength/commonH);
    const remainder=verticalMiddleLength%commonH;
    const leftFullTileCount=Math.floor(fullTileCount/2);
    const leftFullWidth=leftFullTileCount*commonH;
    const remainderStart=leftFullWidth;
    const remainderEnd=remainderStart+remainder;
    let center=0;

    if(fullTileCount>0){
      center=(blendCenterPercent/100)*(fullTileCount-1);
    }

    for(let i=0;i<cols;i++){
      for(let j=0;j<rows;j++){
        if(j<commonH){
          cellValue=patternA[j][i];
        }else if(j>=verticalPatternBStart){
          const patternBRow=j-verticalPatternBStart;
          cellValue=patternB[patternBRow][i];
        }else if(j>=commonH && j<verticalPatternBStart){
          const middleCol=j-commonH;
          let usePatternA=false;

          if(middleCol>=remainderStart && middleCol<remainderEnd){
            const remainderCol=middleCol-remainderStart;
            usePatternA=(remainderCol%2===0);
          }else{
            let tileIndex=0;
            let colInTile=0;

            if(middleCol<remainderStart){
              tileIndex=Math.floor(middleCol/commonW);
              colInTile=middleCol%commonW;
            }else{
              const rightCol=middleCol-remainderEnd;
              tileIndex=leftFullTileCount+Math.floor(rightCol/commonW);
              colInTile=rightCol%commonW;
            }

            let distance=Math.floor(Math.abs(tileIndex-center));
            const isPatternASide=tileIndex<center;
            const isPatternBSide=tileIndex>center;
            const stripeSpacing=2+distance;
            let useOpposite=((colInTile+1)%stripeSpacing===0);

            if(!isPatternASide && !isPatternBSide){
              usePatternA=(colInTile%2===0);
            }else if(isPatternASide){
              usePatternA=!useOpposite;
            }else{
              usePatternA=useOpposite;
            }

            if(usePatternA){
              cellValue=patternA[colInTile][i];
            }else{
              cellValue=patternB[colInTile][i];
            }
          }

          if(middleCol>=remainderStart && middleCol<remainderEnd){
            const centerCol=(middleCol-remainderStart)%commonW;
            if(usePatternA){
              cellValue=patternA[centerCol][i];
            }else{
              cellValue=patternB[centerCol][i];
            }
          }
        }

        drawdown[j][i]=createCell(cellValue);
      }
    }
  }

  let draft=initDraftFromDrawdown(drawdown);    // convert to AdaCAD draft
  draft=updateWeftSystemsAndShuttles(draft, patternAOrg); // give weft mappings
  draft=updateWarpSystemsAndShuttles(draft, patternAOrg); // give warp mappings

  return Promise.resolve([{ draft }]);  // return it to AdaCAD
};

const generateName=(param_vals:Array<OpParamVal>, op_inputs:Array<OpInput>):string=>{  // name draft, copied join left
  const draftAInputs=getAllDraftsAtInlet(op_inputs, 0);
  const draftBInputs=getAllDraftsAtInlet(op_inputs, 1);
  const drafts=draftAInputs.concat(draftBInputs);
  const name_list=parseDraftNames(drafts);
  return "interlacing blend test(" + name_list + ")";
};

const sizeCheck=(op_params:Array<OpParamVal>, op_inputs:Array<OpInput>):boolean=>{ // needed sizecheck for operation
  
  const inputDraftA=getAllDraftsAtInlet(op_inputs, 0);
  const inputDraftB=getAllDraftsAtInlet(op_inputs, 1);
  let middleColumnCount=Math.floor(<number>getOpParamValById(0, op_params));
  if(middleColumnCount<0){
    middleColumnCount=0;
  }
  let changePatternSizeValue=Math.floor(<number>getOpParamValById(2, op_params));
  let isVertical=false;

  if(<number>getOpParamValById(3, op_params)===1){
    isVertical=true;
  }

  if(inputDraftA.length===0 || inputDraftB.length===0){
    return true;
  }

  let totalRows=0;
  let totalCols=0;
  const patternAOrg=inputDraftA[0];
  const patternBOrg=inputDraftB[0];
  const {commonW, commonH}=getCommonSize(patternAOrg, patternBOrg, changePatternSizeValue);

  if(!isVertical){
    totalRows=commonH;
    totalCols=commonW+commonW+middleColumnCount;
  }else{
    totalRows=commonH+commonH+middleColumnCount;
    totalCols=commonW;
  }

  if(<number>getOpParamValById(3, op_params)===1){
    isVertical=true;
  }

  return totalRows*totalCols<=defaults.max_area;
};

export const interlacing_blend: Operation={ name, meta, params, inlets, perform, generateName, sizeCheck };
