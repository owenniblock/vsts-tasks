/// <reference path="../../definitions/node.d.ts" /> 
/// <reference path="../../definitions/vsts-task-lib.d.ts" /> 
 /// <reference path="../../definitions/Q.d.ts" />
import path = require("path");
import tl = require("vsts-task-lib/task");
import fs = require("fs");
import util = require("util");
import q = require("q");

import env = require("./Environment");
import deployAzureRG = require("./DeployAzureRG");

var parameterParse = require("./parameterParse").parse;
var armResource = require("azure-arm-resource");
var request = require("sync-request");

export class ResourceGroup {

    private connectedServiceNameSelector: string;
    private action: string;
    private actionClassic: string;
    private resourceGroupName: string;
    private location: string;
    private csmFile: string;
    private csmParametersFile: string;
    private templateLocation: string;
    private csmFileLink: string;
    private csmParametersFileLink: string;
    private overrideParameters: string;
    private subscriptionId: string;
    private connectedService: string;
    private deploymentMode: string;
    private outputVariable: string;

    private credentials;
    private networkInterfaces;
    private publicAddresses;
    private virtualMachines;
    
    constructor(deployRGObj: deployAzureRG.AzureResourceGroupDeployment) {
            this.connectedService = deployRGObj.connectedService;
            this.action = deployRGObj.action;
            this.resourceGroupName = deployRGObj.resourceGroupName;
            this.location = deployRGObj.location;
            this.csmFile = deployRGObj.csmFile;
            this.csmParametersFile = deployRGObj.csmParametersFile;
            this.overrideParameters = deployRGObj.overrideParameters;
            this.subscriptionId = deployRGObj.subscriptionId;    
            this.deploymentMode = deployRGObj.deploymentMode;
            this.credentials = deployRGObj.credentials;
            this.outputVariable = deployRGObj.outputVariable;
            this.csmFileLink = deployRGObj.csmFileLink;
            this.csmParametersFileLink = deployRGObj.csmParametersFileLink;
            this.templateLocation = deployRGObj.templateLocation;
            this.networkInterfaces = null;
            this.publicAddresses = null;
            this.virtualMachines = null;
            this.execute();
    }

    private execute() {
        switch(this.action) {
           case "Create Or Update Resource Group": 
                this.createOrUpdateRG();
                break;
           case "DeleteRG":
                this.deleteResourceGroup();
                break;
           case "Select Resource Group":
                this.selectResourceGroup();
                break;
           default:
               tl.setResult(tl.TaskResult.Succeeded, tl.loc("InvalidAction"));
        }
    }

    private createDeploymentName(filePath: string): string {
        var name;
        name = path.basename(filePath).split(".")[0].replace(" ", "");
        var ts = new Date(Date.now());
        var depName = util.format("%s-%s%s%s-%s%s", name, ts.getFullYear(), ts.getMonth(), ts.getDate(),ts.getHours(), ts.getMinutes());
        return depName;
    } 

    private updateOverrideParameters(params) {
        var override = parameterParse(this.overrideParameters);
        for (var key in override) {
            params[key] = override[key];
        }
        return params;
    }
    
    private createOrUpdateRG() {
        var armClient = new armResource.ResourceManagementClient(this.credentials, this.subscriptionId);
        armClient.resourceGroups.checkExistence(this.resourceGroupName, (error, exists, request, response) => {
            if (error) {
                tl.setResult(tl.TaskResult.Failed, tl.loc("ResourceGroupStatusFetchFailed", error))
            }
            if (exists) {
                this.createTemplateDeployment(armClient);
            } else {
                this.createRG(armClient).then((Succeeded) => {
                    this.createTemplateDeployment(armClient);
                });
            }
        });
    }

    private createRG(armClient): q.Promise<any> {
        var deferred = q.defer<any>();
        console.log(this.resourceGroupName+" resource Group Not found");
        console.log("Creating a new Resource Group:"+ this.resourceGroupName);
        armClient.resourceGroups.createOrUpdate(this.resourceGroupName, {"name": this.resourceGroupName, "location": this.location}, (error, result, request, response) => {
            if (error) {
                tl.setResult(tl.TaskResult.Failed, tl.loc("ResourceGroupCreationFailed", error));
                deferred.reject(error);
            } 
            deferred.resolve("Succeeded");
        });
        return deferred.promise;
    }
    
    private getDeploymentDataForExternalLinks() {
        var properties = {}
        properties["templateLink"] = {"uri" : this.csmFileLink};
        if (this.csmParametersFileLink && this.csmParametersFileLink.trim()!="" && this.overrideParameters.trim()=="")
            properties["parametersLink"] = {"uri" : this.csmParametersFileLink };
        else {
            var params = {};
            if (this.csmParametersFileLink && this.csmParametersFileLink.trim()) {
                var response = request("GET", this.csmParametersFileLink);
                try { 
                    params = JSON.parse(response.body).parameters;
                } catch(error) {
                    tl.setResult(tl.TaskResult.Failed, "Make sure the end point is a JSON");
                }
            }
            params = this.updateOverrideParameters(params);
            properties["parameters"] = params;
        }
        properties["mode"] = this.deploymentMode;
        properties["debugSetting"] = {"detailLevel": "requestContent, responseContent"};
        var deployment = {"properties": properties};
        deployment["location"] = this.location;
        return deployment;
    }

    private getDeploymentDataForLinkedArtifact() {
        var template;
        try { 
            template = JSON.parse(fs.readFileSync(this.csmFile, 'UTF-8'));
        }
        catch (error) {
            tl.setResult(tl.TaskResult.Failed, tl.loc("TemplateParsingFailed", error.message));
            return;
        }
        var parameters;
        try {
            if (this.csmParametersFile && this.csmParametersFile.trim()) {
                var parameterFile = JSON.parse(fs.readFileSync(this.csmParametersFile, 'UTF-8'));
                parameters = parameterFile.parameters;
            }
            if (this.overrideParameters)
                parameters = this.updateOverrideParameters(parameters);
        }
        catch (error) {
            tl.setResult(tl.TaskResult.Failed, tl.loc("ParametersFileParsingFailed", error.message));
            return;
        }
        var properties = {}
        properties["template"] = template;
        properties["parameters"] = parameters;
        properties["mode"] = this.deploymentMode;
        properties["debugSetting"] = {"detailLevel": "requestContent, responseContent"};
        var deployment = {"properties": properties};
        deployment["location"] = this.location;
        return deployment;
    }

    private createTemplateDeployment(armClient) {
        var deployment;
        if (this.templateLocation === "Linked Artifact") {
            deployment = this.getDeploymentDataForLinkedArtifact();
        }  else {
            deployment = this.getDeploymentDataForExternalLinks();
        }
        armClient.deployments.createOrUpdate(this.resourceGroupName, this.createDeploymentName(this.csmFile), deployment, null, (error, result, request, response) => {
            if (error) {
                tl.setResult(tl.TaskResult.Failed, tl.loc("RGO_createTemplateDeploymentFailed", error.message));
                return;
            }
            try {
                if (this.outputVariable && this.outputVariable.trim() != "")
                    new env.RegisterEnvironment(this.credentials, this.subscriptionId, this.resourceGroupName, this.outputVariable);
            } catch(error) {            
                tl.setResult(tl.TaskResult.Failed, tl.loc("FailedRegisteringEnvironment", error));
                return;
            }
            tl.setResult(tl.TaskResult.Succeeded, tl.loc("RGO_createTemplateDeploymentSucceeded", this.resourceGroupName));
        });
    }

    private deleteResourceGroup() {
        var armClient = new armResource.ResourceManagementClient(this.credentials, this.subscriptionId);
        console.log(tl.loc("ARG_DeletingResourceGroup", this.resourceGroupName));
        armClient.resourceGroups.deleteMethod(this.resourceGroupName,(error, result, request, response) => {
            if (error) {
                tl.setResult(tl.TaskResult.Failed, tl.loc("RGO_CouldNotDeletedResourceGroup", this.resourceGroupName, error.message));
                return;
            }
            tl.setResult(tl.TaskResult.Succeeded, tl.loc("RGO_DeletedResourceGroup", this.resourceGroupName));
        });
    }
    
    private selectResourceGroup() {
        try {
            new env.RegisterEnvironment(this.credentials, this.subscriptionId, this.resourceGroupName, this.outputVariable);

        } catch(error) {            
            tl.setResult(tl.TaskResult.Failed, tl.loc("FailedRegisteringEnvironment", error));
            return;
        }
        tl.setResult(tl.TaskResult.Succeeded, tl.loc("selectResourceGroupSuccessfull", this.resourceGroupName, this.outputVariable))
    }
}