const remote = require('electron').remote;
const Immutable = require('immutable');
const {ipcRenderer} = require('electron');
const jsonfile = require('jsonfile');

const config = require('./config_browser');

const CLOSE_BUTTON_ID = 'close';

const HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json'
};


const DEF_PUBLIC_NAME = 'NDEx Public Server';
const DEF_PUBLIC_SERVER = 'http://public.ndexbio.org';

let defaultState = Immutable.Map({
  serverName: DEF_PUBLIC_NAME,
  serverAddress: DEF_PUBLIC_SERVER,
  userName: "",
  userPass: "",
  loggedIn: false
});

let tempDir;

// For saving to local directory
function storeFile(cx, fileName) {
  const file = tempDir + fileName;
  jsonfile.writeFile(file, cx, err => {
    if (err != null || err != undefined) {
      console.error(err);
    } else {
      // OK
    }
  });
}
// Get options from main process
ipcRenderer.on('ping', (event, arg) => {
  console.log(arg);
  console.log(event);
  loginInfo = arg;
  console.log('Login Options available:');
  console.log(loginInfo);

  const gl = remote.getGlobal('sharedObj');
  tempDir = gl.temp;

  if (loginInfo === undefined || loginInfo === null || loginInfo === {}) {
  } else {
    loginInfo['loggedIn'] = true;
    defaultState = Immutable.Map(loginInfo);
  }

  startApp();
});

// Name of the redux store
const STORE_NDEX = 'ndex';


const MESSAGE_TYPE = {
  QUERY: 'query'
};


let cyto;

function startApp() {
  addCloseButton();
}

function addCloseButton() {
  document.getElementById(CLOSE_BUTTON_ID)
    .addEventListener('click', () => {
      remote.getCurrentWindow().close();
    });

  init();
}

let cySocket;


function createNetworkList(idList, isPublic) {
  let list = [];

  const store = cyto.getStore(STORE_NDEX);
  const server = store.server.toJS();

  idList.map(id => {

    let source = null;
    if (isPublic) {
      source = server.serverAddress + '/rest/network/' + id + '/asCX';
    } else {
      // Private
      source = 'file://' + tempDir + id + '.json';
      console.log(source);
    }

    console.log('============= Creating entry');
    console.log(source);

    let entry = {
      source_location: source,
      source_method: 'GET',
      ndex_uuid: id
    };
    list.push(entry);
  });
  return list;
}

function getImportQuery(ids, isPublic) {
  return {
    method: 'post',
    headers: HEADERS,
    body: JSON.stringify(createNetworkList(ids, isPublic))
  };
}

function applyLayout(results) {
  results.map(result => {
    const suid = result.networkSUID;
    console.log("LAYOUT: " + suid);
    console.log(typeof suid);
    fetch('http://localhost:1234/v1/apply/layouts/force-directed/' + suid);
  });
}


// Use first entry as its collection name
function getNetworkSummary(id) {
  const credentials = defaultState.toJS();
  const url = credentials.serverAddress + '/rest/network/' + id.externalId;

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (credentials.userName !== undefined
    && credentials.userName !== null && credentials.userName !== '') {
    headers.Authorization = 'Basic ' + btoa(credentials.userName + ':' + credentials.userPass);
  }

  const param = {
    method: 'get',
    headers: headers
  };

  console.log("# fetch called: " + id.externalId);
  return fetch(url, param);
}

function getSummaries(ids) {
  return Promise.all(ids.map(getNetworkSummary));
}


function getSubnetworkCount(net) {
  const subnets = new Set();
  const netProps = net.properties;
  netProps.map(prop => {
    const subnetId = prop.subNetworkId;
    if (subnetId != null && subnetId != undefined) {
      subnets.add(subnetId);
    }
  });

  return subnets.size;
}

function importAsOneCollection(ids) {
  let singleCollectionName = null;
  const collections = {};
  const singles = [];

  const privateNetworks = new Set();

  getSummaries(ids)
    .then(responses => {
      return Promise.all(responses.map(rsp => {
        return rsp.json();
      }));
    })
    .then(res => {
      res.map(net => {
        // Check private or not
        if (net.visibility === 'PRIVATE') {
          privateNetworks.add(net.externalId);
        }

        const count = getSubnetworkCount(net);
        if (count !== 0) {
          // Multiple networks
          collections[net.name] = [net.externalId];
        } else {
          if (singleCollectionName === null) {
            singleCollectionName = net.name;
          }
          singles.push(net.externalId);
        }
      });
    })
    .then(() => {
      // Save all
      return Promise.all(ids.map(id => {
        if (privateNetworks.has(id.externalId)) {
          fetchNetwork(id.externalId);
        }
      }));
    })
    .then(() => {
      collections[singleCollectionName] = singles;
      const keys = Object.keys(collections);
      console.log(keys);
      keys.map(key => {
        if(key === singleCollectionName) {
          createDummy(key, collections[key], privateNetworks, true);
        } else {
          createDummy(key, collections[key], privateNetworks, false);
        }
      });
    });
}

function fetchNetwork(uuid) {

  const credentials = defaultState.toJS();

  const param = {
    method: 'get',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + btoa(credentials.userName + ':' + credentials.userPass)
    }
  };

  const address = credentials.serverAddress;
  const url = address + '/rest/network/' + uuid + '/asCX';
  fetch(url, param)
    .then(response => {
      return response.json();
    })
    .then(json => {
      storeFile(json, uuid + '.json');
    });
}

function importAll(collectionName, ids, dummy, privateNetworks, doLayout) {

  const publicNets = [];
  const privateNets = [];

  ids.map(id => {
    if (privateNetworks.has(id)) {
      privateNets.push(id);
    } else {
      console.log("$$$ Public");
      publicNets.push(id);
    }
  });

  fetch(config.CYREST.IMPORT_NET + '&collection=' + collectionName, getImportQuery(publicNets, true))
    .then(response => {
      return response.json();
    })
    .then(json => {
      if(doLayout) {
        applyLayout(json);
      }
    })
    .then(() => {
      fetch(config.CYREST.IMPORT_NET + '&collection=' + collectionName, getImportQuery(privateNets, false))
        .then(() => deleteDummy(dummy));
    });
}


function deleteDummy(dummy) {
  const q = {
    method: 'delete',
    headers: HEADERS
  };

  fetch('http://localhost:1234/v1/networks/' + dummy, q);

}

function createDummy(collectionName, ids, privateNetworks, doLayout) {
  const q = {
    method: 'post',
    headers: HEADERS,
    body: JSON.stringify(config.EMPTY_NET)
  };

  fetch('http://localhost:1234/v1/networks?collection=' + collectionName, q)
    .then(response => {
      return response.json()
    })
    .then(json => {
      const dummySuid = json.networkSUID;
      console.log(dummySuid);
      importAll(collectionName, ids, dummySuid, privateNetworks, doLayout);
    });
}

function init() {
  initCyComponent(defaultState);
  updateWindowProps(cyto.getStore(STORE_NDEX).server.toJS());
  initWsConnection();
}

function initWsConnection() {
  cySocket = new WebSocket(config.WS_SERVER);

  cySocket.onopen = () => {
    cySocket.send(JSON.stringify(config.MESSAGES.CONNECT));
  };

  cySocket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.from !== 'cy3') {
      return;
    }

    switch (msg.type) {
      case MESSAGE_TYPE.QUERY:
      {
        const query = msg.body;
        cyto.dispatch(NDExValet.fieldActions.updateQuery(query));
        const store = cyto.getStore(STORE_NDEX);
        const server = store.server.toJS();
        cyto.dispatch(NDExStore.luceneActions.searchFor(server, query));
        break;
      }
      default:
      {
        break;
      }
    }
  };

  // Keep alive by sending notification...
  setInterval(function () {
    cySocket.send(JSON.stringify(config.MESSAGES.ALIVE));
  }, 120000);

}

function initCyComponent(serverState) {
  cyto = CyFramework.config([NDExValet, NDExStore], {
    ndex: {
      server: serverState
    }
  });
  cyto.render(NDExValet, document.getElementById('valet'), {
    theme: {
      palette: {
        primary1Color: '#6E93B6',
        primary2Color: '#244060',
        primary3Color: '##EDEDED',
        accent1Color: '#D69121',
        accent2Color: '#E4E4E4',
        accent3Color: '##9695A6'
      }
    },
    style: {
      backgroundColor: '#EDEDED'
    },
    onLoad: ids => {
      importAsOneCollection(ids);
    }
  });
}

function updateWindowProps(server) {
  remote.getCurrentWindow()
    .setTitle('Connected: ' + server.serverName + ' ( ' + server.serverAddress + ' )');
}

