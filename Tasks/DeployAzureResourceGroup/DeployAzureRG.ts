/// <reference path="../../definitions/node.d.ts" /> 
/// <reference path="../../definitions/Q.d.ts" /> 
/// <reference path="../../definitions/vsts-task-lib.d.ts" /> 
 
import tl = require("vsts-task-lib/task");
import fs = require("fs");
import util = require("util");

var msRestAzure = require("ms-rest-azure");

import virtualMachine = require("./VirtualMachine");
import resourceGroup = require("./ResourceGroup");
import env = require("./Environment");

export class AzureResourceGroupDeployment {

    public action:string;
    public resourceGroupName:string;
    public location:string;
    public csmFile:string;
    public csmParametersFile:string;
    public templateLocation:string;
    public csmFileLink:string;
    public csmParametersFileLink:string;
    public overrideParameters:string;
    public enableDeploymentPrerequisites:boolean;
    public outputVariable:string;
    public subscriptionId:string;
    public connectedService:string;
    public isLoggedIn:boolean = false;
    public deploymentMode:string;
    public credentials;
    
    constructor() {
        try { 
            this.connectedService = tl.getInput("ConnectedServiceName", true);
            this.subscriptionId = tl.getEndpointDataParameter(this.connectedService, "SubscriptionId", true);   
            this.resourceGroupName = tl.getInput("resourceGroupName", true);
            this.action = tl.getInput("action");
            this.location = tl.getInput("location");
            this.csmFile = tl.getPathInput("csmFile");
            this.csmParametersFile = tl.getPathInput("csmParametersFile");
            this.csmFileLink = tl.getInput("csmFileLink");
            this.csmParametersFileLink = tl.getInput("csmParametersFileLink");
            this.templateLocation = tl.getInput("templateLocation");
            this.overrideParameters = tl.getInput("overrideParameters");
            this.enableDeploymentPrerequisites = tl.getBoolInput("enableDeploymentPrerequisites");
            this.outputVariable = tl.getInput("outputVariable");
             
            this.deploymentMode = tl.getInput("deploymentMode");
            this.credentials = this.getARMCredentials();
        }
        catch (error) {
            tl.setResult(tl.TaskResult.Failed, tl.loc("ARGD_ConstructorFailed", error.message));
        }
    }

    public execute() {
        switch (this.action) {
           case "Create Or Update Resource Group": 
           case "DeleteRG":
           case "Select Resource Group":
                new resourceGroup.ResourceGroup(this);
                break;
           case "Start":
           case "Stop":
           case "Restart":
           case "Delete":
               new virtualMachine.VirtualMachine(this.resourceGroupName, this.action, this.subscriptionId, this.connectedService, this.getARMCredentials());
               break;
           default:
               tl.setResult(tl.TaskResult.Succeeded, tl.loc("InvalidAction"));
        }
    }

     private getARMCredentials() {
        var endpointAuth = tl.getEndpointAuthorization(this.connectedService, true);
        var servicePrincipalId:string = endpointAuth.parameters["serviceprincipalid"];
        var servicePrincipalKey:string = endpointAuth.parameters["serviceprincipalkey"];
        var tenantId:string = endpointAuth.parameters["tenantid"];
        var credentials = new msRestAzure.ApplicationTokenCredentials(servicePrincipalId, tenantId, servicePrincipalKey);
        return credentials;
    }
}
