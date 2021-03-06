'use strict';
import React from 'react';
import ReactDOM from 'react-dom';

import GithubCorner from 'react-github-corner';

import Progress from 'essence-progress';
import UserAvatar from 'react-user-avatar';
import SmartTimeAgo from 'react-smart-time-ago';

import {memoize} from 'lodash';

import { numberToColorHsl } from './color';
import './app.scss';

window.WebFontConfig = {
  google: { families: [ 'Roboto:400,700:latin', 'Roboto+Mono:400,700:latin' ] }
};
(function() {
  var wf = document.createElement('script');
  wf.src = 'https://ajax.googleapis.com/ajax/libs/webfont/1/webfont.js';
  wf.type = 'text/javascript';
  wf.async = 'true';
  var s = document.getElementsByTagName('script')[0];
  s.parentNode.insertBefore(wf, s);
})();

const token = document.querySelector('meta[name=gh-token]').attributes.content.value;
const Config = window.Config;
const fetchOptions = {
  headers: {
    'Authorization': 'token ' + token
  }
};

//const Progress = () => { return <div></div>; }

const getConfig = memoize(function () {
  return fetch('https://api.github.com/repos/' + Config.config_repo + '/git/trees/master', fetchOptions)
    .then(response => response.json())
    .then(data => data.tree.find(x => x.path === 'config.json').url)
    .then(url => fetch(url, fetchOptions))
    .then(response => response.json())
    .then(blob =>  JSON.parse(window.atob(blob.content.replace(/\s/g, ''))))
    .then(projects => {
      projects = projects.repos;
      return Promise.all(projects.map((project) => {
        return tagsForProject(project).then(tags => {
          project.tags = tags;
          project.commits = [];
          if (tags.length > 1) {
            return compareSha(project, tags[0], tags[1])
              .then(commits => project.commits = commits.reverse());
          } else {
            return getCommit(project, tags[0])
              .then(commit => project.commits = [commit]);
          }
        });
      })).then(function() { return projects });
    });
});

const tagsForProject = memoize(function (project) {
  if (project.tag) { return Promise.resolve([project.tag]); }
  return fetch('https://api.github.com/repos/' + project.repo + '/tags', fetchOptions)
    .then(response => response.json())
    .then(tags => tags.map(tag => tag.name));
});

const getCommit = memoize(function (project, sha) {
  return fetch('https://api.github.com/repos/' + project.repo + '/commits?sha=' + sha, fetchOptions)
    .then(response => response.json())
    .then(commits => { return processCommit(commits[0]); });
});

const processCommit = function (commit) {
  return {
    message: commit.commit.message.replace(/Merge pull request #\d+ from \w+\/[^ ]+/, ''),
    sha: commit.sha,
    date: commit.commit.author.date,
    author: {
      name: commit.commit.author.name,
      email: commit.commit.author.email,
      avatar_url: commit.author.avatar_url,
      login: commit.author.login
    },
    committer: {
      name: commit.commit.committer.name,
      email: commit.commit.committer.email,
      avatar_url: commit.committer.avatar_url,
      login: commit.committer.login
    }
  };
}

const compareSha = memoize(function (project, sha1, sha2) {
  return fetch(`https://api.github.com/repos/${project.repo}/compare/${sha2}...${sha1}`, fetchOptions)
    .then(response => response.json())
    .then(json => { return json.commits.map(commit => processCommit(commit)) });
});

function projectStaleness(lastUpDate, target = 1) {
  let daysAgo = (Date.now() - lastUpDate.getTime()) / 1000 / 60 / 60 / 24;
  // magic coefficient that shapes the staleness curve
  // experimentally determined!!!
  let stalenessCoeff = 1 / (2.4 * Math.pow(target, 0.7));
  // generate a 1/(sqrt(x)+1)-type curve with some fiddly awesomeness
  let staleness = (Math.pow((stalenessCoeff * daysAgo) + 1, -1)) /
                  ((stalenessCoeff * Math.sqrt(daysAgo)) + 1);
  return staleness;
}

class App extends React.Component {

  constructor() {
    super();
    this.state = { };
  }

  componentDidMount() {
    getConfig()
      .then(config => this.setState({ projects: config }))
      /*
      .catch(error => {
        console.error(error); // eslint-disable-line
        this.setState({ error: 'error fetching config:' + error })
      });
      */
  }

  render() {
    if (this.state.projects) { return <Projects projects={this.state.projects} />; }
    return (
      <div>
        <br />
        <br />
        <br />
        <Progress type={'circle'} color={'black'} />
        {!this.state.projects && <div>Loading Projects from {Config.config_repo}</div>}
        {this.state.error && <div>Error - {this.state.error}</div>}
      </div>
    );
  }

}

class Commit extends React.Component {
  static propTypes = {
    commit: React.PropTypes.object.isRequired
  };
  render() {
    return (
      <div className="commit">
        <span className="message" title={this.props.commit.message}>{this.props.commit.message}</span>
        <span className="author">{this.props.commit.author.name}</span>
        <span className="sha">[{this.props.commit.sha.slice(0,6)}]</span>
      </div>
    );
  }
}

class Project extends React.Component {
  static propTypes = {
    project: React.PropTypes.object.isRequired,
    commits: React.PropTypes.array
  };
  render() {
    if (!this.props.commits) { return <div />; }

    const commits = this.props.commits;
    const project = this.props.project;
    // if the config has a deployIntervalTarget, retrieve; default is deploying
    // once per day
    const useTarget = !!this.props.project.deployTargetInterval;
    const cardStyle = {};
    if (useTarget) {
      const depTargetInt = this.props.project.deployTargetInterval || 1;
      const staleness = projectStaleness(new Date(commits[0].date), depTargetInt);
      cardStyle.backgroundColor = numberToColorHsl(staleness);
    }

    return (
      <div className="card" style={cardStyle}>
        <div className="header">
          <div className="info">
            <div className="repo">{project.repo.split('/')[1]}</div>
            <span className="ago"><SmartTimeAgo value={new Date(commits[0].date)} /></span>
            <span> by </span>
            <span className="author">{commits[0].author.name}</span>
          </div>
          <UserAvatar size='60' name={commits[0].author.name} src={commits[0].author.avatar_url} className="avatar" />
        </div>
        <div className="body">
          <h2>{project.tags.slice(0,2).reverse().join('...')}</h2>
          {commits.map((commit) => <Commit key={commit.sha} commit={commit} />)}
        </div>
      </div>
    );
  }
}


class Projects extends React.Component {
  static propTypes = {
    projects: React.PropTypes.array.isRequired
  };

  render() {
    return (
      <div>
        <GithubCorner href="https://github.com/halkeye/release-dashboard" />
        <div className="projectsContainer">{
          this.props.projects.map(project => {
            if (!project.commits || !project.commits.length) { return <div />; }
            return <Project
              key={project.repo}
              project={project}
              commits={project.commits}
            />;
          })
        }</div>
      </div>
    );
  }
}

ReactDOM.render(
  <App />,
  document.getElementById('content')
);
